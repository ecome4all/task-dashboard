import { Router } from "express";
import { Prisma } from "@prisma/client";
import { clientRepository } from "../repositories/clientRepository";
import { taskRepository } from "../repositories/taskRepository";
import { taskNoteRepository } from "../repositories/taskNoteRepository";
import { unrecognizedMessageRepository } from "../repositories/unrecognizedMessageRepository";
import { requireRole } from "../auth/requireRole";
import { WhatsAppChannels } from "../whatsapp/resolveAdapter";
import { buildWeeklyReportPreview, buildReport, isReportKind } from "../services/weeklyReportPreview";
import { sheetProblemOf } from "../services/googleSheets";
import { changedFieldsSince, TaskSnapshot } from "../services/taskMessages";

// Same audience as report-links: admins and managers are the ones who
// send reports to clients, so they're the ones who maintain the directory.
const MANAGE_ROLES = ["admin", "manager"];

export function createClientsRouter(channels: WhatsAppChannels) {
  const router = Router();

  router.get("/", requireRole(...MANAGE_ROLES), async (_req, res) => {
    res.json(await clientRepository.list());
  });

  router.get("/all", requireRole(...MANAGE_ROLES), async (_req, res) => {
    res.json(await clientRepository.listAll());
  });

  // Senders (individuals or groups) that have sent a task: message but
  // aren't tied to any active client yet, so their messages were logged to
  // UnrecognizedMessage instead of becoming a task — staff link them to a
  // client manually via PATCH /:id, nothing here is auto-matched. First
  // occurrence per chat_id (rows are newest-first) also gives us the most
  // recently seen chat_name and message count.
  router.get("/unrecognized", requireRole(...MANAGE_ROLES), async (_req, res) => {
    const [rows, linkedIds] = await Promise.all([
      unrecognizedMessageRepository.listSources(),
      clientRepository.linkedGroupIds(),
    ]);

    const senders = new Map<
      string,
      { chatId: string; chatName: string | null; messageCount: number; lastSeenAt: Date }
    >();
    for (const row of rows) {
      if (linkedIds.has(row.sourceRef)) continue;
      const existing = senders.get(row.sourceRef);
      if (existing) {
        existing.messageCount += 1;
      } else {
        senders.set(row.sourceRef, {
          chatId: row.sourceRef,
          chatName: row.chatName,
          messageCount: 1,
          lastSeenAt: row.createdAt,
        });
      }
    }

    res.json([...senders.values()].sort((a, b) => b.lastSeenAt.getTime() - a.lastSeenAt.getTime()));
  });

  // Dismiss a sender from the Unrecognized Senders list without linking them
  // to a client — e.g. a wrong number or a one-off message that was never
  // going to become a real client. Clears their logged messages; if the
  // same chat_id sends another task: message later, it's logged fresh and
  // reappears here, so this isn't a permanent block.
  router.delete("/unrecognized/:chatId", requireRole(...MANAGE_ROLES), async (req, res) => {
    await unrecognizedMessageRepository.deleteBySourceRef(req.params.chatId);
    res.status(204).send();
  });

  router.post("/", requireRole(...MANAGE_ROLES), async (req, res) => {
    const { name, phone, notes } = req.body;
    if (typeof name !== "string" || !name.trim()) {
      res.status(400).json({ error: "name is required" });
      return;
    }
    res.status(201).json(
      await clientRepository.create({
        name: name.trim(),
        phone: typeof phone === "string" && phone.trim() ? phone.trim() : undefined,
        notes: typeof notes === "string" && notes.trim() ? notes.trim() : undefined,
      })
    );
  });

  router.patch("/:id", requireRole(...MANAGE_ROLES), async (req, res) => {
    const { name, phone, notes, active, reportSheetUrl } = req.body;
    if (name !== undefined && (typeof name !== "string" || !name.trim())) {
      res.status(400).json({ error: "name must be a non-empty string" });
      return;
    }
    if (active !== undefined && typeof active !== "boolean") {
      res.status(400).json({ error: "active must be a boolean" });
      return;
    }
    const client = await clientRepository.update(req.params.id, {
      ...(name !== undefined && { name: name.trim() }),
      ...(phone !== undefined && { phone }),
      ...(notes !== undefined && { notes }),
      ...(active !== undefined && { active }),
      ...(reportSheetUrl !== undefined && { reportSheetUrl: reportSheetUrl?.trim() || null }),
    });
    res.json(client);
  });

  // Hard delete — separate from the active/inactive toggle in PATCH above,
  // which is the reversible default. This is for actually removing a
  // mistaken or duplicate entry, not routine offboarding.
  router.delete("/:id", requireRole(...MANAGE_ROLES), async (req, res) => {
    await clientRepository.delete(req.params.id);
    res.status(204).send();
  });

  // Links one more WhatsApp group to a client — a client can be in several
  // (e.g. separate regional or purpose-specific groups), so this adds
  // rather than replaces. Used both by the Clients screen's own "Add group"
  // form and by "Link" on the Unrecognized Senders screen.
  router.post("/:id/groups", requireRole(...MANAGE_ROLES), async (req, res) => {
    const { groupId, groupName } = req.body;
    if (typeof groupId !== "string" || !groupId.trim()) {
      res.status(400).json({ error: "groupId is required" });
      return;
    }
    try {
      const group = await clientRepository.addGroup(
        req.params.id,
        groupId.trim(),
        typeof groupName === "string" && groupName.trim() ? groupName.trim() : null
      );
      res.status(201).json(group);
    } catch (err) {
      // P2002: unique constraint on (tenantId, groupId) — this chat_id is
      // already linked to some client (maybe this one, maybe another).
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        res.status(409).json({ error: "This WhatsApp group is already linked to a client." });
        return;
      }
      throw err;
    }
  });

  router.delete("/:id/groups/:groupRowId", requireRole(...MANAGE_ROLES), async (req, res) => {
    await clientRepository.removeGroup(req.params.groupRowId);
    res.status(204).send();
  });

  // Everything the Client Details screen shows about one client in a single
  // round trip: the client record itself plus every task ever logged for
  // them. The per-status/per-employee counts aren't computed here — the
  // frontend already has to hold the task list to render the table, and it's
  // the side that owns the status *labels* (config options are admin-
  // editable), so counting there keeps one source of truth for both.
  router.get("/:id/overview", requireRole(...MANAGE_ROLES), async (req, res) => {
    const client = await clientRepository.findById(req.params.id);
    if (!client) {
      res.status(404).json({ error: "client not found" });
      return;
    }

    const [tasks, noteCounts] = await Promise.all([
      taskRepository.listForClient({
        name: client.name,
        groupIds: client.whatsappGroups.map((g) => g.groupId),
        phone: client.phone,
      }),
      taskNoteRepository.countsByTask(),
    ]);

    res.json({
      client,
      // Same shape the Tasks board gets from GET /api/tasks, so the details
      // screen can reuse the exact same Task type and row rendering.
      tasks: tasks.map((task) => ({
        ...task,
        pendingSendFields: changedFieldsSince(task, task.sentSnapshot as TaskSnapshot | null),
        noteCount: noteCounts[task.id] ?? 0,
      })),
    });
  });

  // Live-reads this client's linked Google Sheet for the current week's
  // numbers — no persisted snapshot, so it's always in sync with whatever's
  // currently in the sheet. See services/weeklyReportPreview.ts for how
  // "current period" is matched across the known tabs.
// Turns a failed sheet read into something the person reading it can act on.
// Every failure used to say "check it's shared with the service account and
// the link is correct" — so when Google simply answered slowly under a burst
// of reads, staff went looking for a sharing problem that didn't exist, on
// sheets that were fine. Each cause now names itself, and only one of them
// is the reader's to fix.
function sheetFailure(err: unknown): { status: number; error: string } {
  switch (sheetProblemOf(err)) {
    case "not_shared":
      return {
        status: 502,
        error:
          "This client's sheet isn't shared with the reports account yet. Open the sheet in Google Sheets, press Share, and give Viewer access to " +
          (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ?? "the reports account") + ".",
      };
    case "not_found":
      return { status: 502, error: "That sheet link doesn't open. Check the Report Sheet link on the Clients screen." };
    case "busy":
      return {
        status: 503,
        error:
          "Google was busy, or too many sheets were read in the last minute. Wait a minute, then press Retry — " +
          "there's nothing wrong with this sheet.",
      };
    case "credentials":
      return {
        status: 502,
        error: "The Google connection isn't working. This affects every client, not just this one — an admin should check Google Sheets setup.",
      };
    default:
      return { status: 502, error: "Couldn't read this client's report sheet. Press Retry, and if it keeps happening check the link and sharing." };
  }
}

// The date a report is being asked about, as YYYY-MM-DD.
//
// Built at midday local time on purpose: a date built at midnight can fall
// into the day before once a timezone is applied, and every period this
// decides — the day, the week, the month — comes from the calendar date, never
// from the clock.
//
// Nothing sent means today, which is the normal case. Something sent that
// isn't a real date is not: reporting on today when a different day was asked
// for would go out to a client under the wrong date, so it is refused rather
// than guessed at.
function parseDateParam(value: unknown): Date | null | "invalid" {
  if (value === undefined || value === "") return null;
  if (typeof value !== "string") return "invalid";

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return "invalid";

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day, 12);

  // Date rolls 2026-02-31 forward into March rather than rejecting it, so the
  // parts are checked back against what was asked for.
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return "invalid";
  }
  return date;
}

  router.get("/:id/weekly-report-preview", requireRole(...MANAGE_ROLES), async (req, res) => {
    const client = await clientRepository.findById(req.params.id);
    if (!client) {
      res.status(404).json({ error: "client not found" });
      return;
    }
    if (!client.reportSheetUrl) {
      res.status(400).json({ error: "No report sheet linked for this client." });
      return;
    }

    try {
      const preview = await buildWeeklyReportPreview(client.reportSheetUrl, new Date());
      res.json(preview);
    } catch (err) {
      console.error(`Failed to read report sheet for client ${client.id}:`, err);
      const failure = sheetFailure(err);
      res.status(failure.status).json({ error: failure.error });
    }
  });

  // One specific report (Daily / Weekly Sales / Weekly SKU) read live from
  // this client's sheet. Separate from /weekly-report-preview above, which
  // reads every tab at once for the combined review screen.
  //
  // ?date=YYYY-MM-DD picks which day the report is about — the Reports screen
  // sends whichever date the person chose there. It decides the day a daily
  // report reads, and the week and month the other reports read, so a report
  // for a period already gone by can still be sent. Left off, it is today.
  router.get("/:id/report-preview/:kind", requireRole(...MANAGE_ROLES), async (req, res) => {
    if (!isReportKind(req.params.kind)) {
      res.status(400).json({ error: "unknown report" });
      return;
    }

    const on = parseDateParam(req.query.date);
    if (on === "invalid") {
      res.status(400).json({ error: "That date wasn't understood. Pick one from the calendar." });
      return;
    }

    const client = await clientRepository.findById(req.params.id);
    if (!client) {
      res.status(404).json({ error: "client not found" });
      return;
    }
    if (!client.reportSheetUrl) {
      res.status(400).json({ error: "No report sheet linked for this client." });
      return;
    }

    try {
      res.json(await buildReport(client.reportSheetUrl, req.params.kind, on ?? new Date()));
    } catch (err) {
      console.error(`Failed to read report sheet for client ${client.id}:`, err);
      const failure = sheetFailure(err);
      res.status(failure.status).json({ error: failure.error });
    }
  });

  // The message text itself is composed on the frontend (the account manager
  // picks which fields to include and sees a live preview there) — this route
  // only exists because sending WhatsApp messages needs server-side API keys.
  router.post("/:id/send-update", requireRole(...MANAGE_ROLES), async (req, res) => {
    const { phone, channel, message } = req.body;
    if (typeof phone !== "string" || !phone.trim()) {
      res.status(400).json({ error: "phone is required" });
      return;
    }
    if (channel !== "whapi" && channel !== "official") {
      res.status(400).json({ error: "channel must be 'whapi' or 'official'" });
      return;
    }
    if (typeof message !== "string" || !message.trim()) {
      res.status(400).json({ error: "message is required" });
      return;
    }

    try {
      await channels[channel as "whapi" | "official"].sendMessage(phone.trim(), message.trim());
    } catch (err) {
      // A failed send (network blip, bad number, provider outage) must not
      // crash the server — an uncaught rejection here would take down the
      // whole process, not just this one request.
      console.error("Failed to send client update:", err);
      res.status(502).json({ error: "Couldn't send the message. Try again." });
      return;
    }
    res.json({ sent: true });
  });

  return router;
}
