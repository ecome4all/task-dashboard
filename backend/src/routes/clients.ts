import { Router } from "express";
import { Prisma } from "@prisma/client";
import { clientRepository } from "../repositories/clientRepository";
import { taskRepository } from "../repositories/taskRepository";
import { taskNoteRepository } from "../repositories/taskNoteRepository";
import { unrecognizedMessageRepository } from "../repositories/unrecognizedMessageRepository";
import { configOptionRepository } from "../repositories/configOptionRepository";
import { requireRole } from "../auth/requireRole";
import { WhatsAppChannels } from "../whatsapp/resolveAdapter";
import { buildWeeklyReportPreview, buildReport, isReportKind } from "../services/weeklyReportPreview";
import { sheetProblemOf, sheetErrorDetail } from "../services/googleSheets";
import { changedFieldsSince, TaskSnapshot } from "../services/taskMessages";

// Same audience as report-links: admins and managers are the ones who
// send reports to clients, so they're the ones who maintain the directory.
const MANAGE_ROLES = ["admin", "manager"];

interface LinkedSheet {
  id: string;
  marketplace: string;
  sheetUrl: string;
}

// Which of a client's sheets a report route should read.
//
// A marketplace asked for in the query wins. With none asked for and only one
// sheet linked there's nothing to be ambiguous about, so that one is used —
// which is also what keeps every client who had a single sheet before this
// change working untouched. With several linked and nothing asked for, this
// refuses rather than picking: sending a client their Flipkart figures headed
// "Amazon" is worse than answering with an error.
function pickReportSheet(
  sheets: LinkedSheet[],
  asked: unknown
): { sheet: LinkedSheet } | { error: string } {
  if (sheets.length === 0) return { error: "No report sheet linked for this client." };

  if (typeof asked === "string" && asked.trim()) {
    const sheet = sheets.find((s) => s.marketplace === asked.trim());
    return sheet ? { sheet } : { error: "No report sheet linked for this client on that marketplace." };
  }

  if (sheets.length > 1) return { error: "This client has sheets for more than one marketplace. Pick which one." };
  return { sheet: sheets[0] };
}

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
    // Report sheets are not here: a client has one per marketplace now, added
    // and removed through /:id/report-sheets below rather than as a field.
    const { name, phone, notes, active } = req.body;
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
    });
    res.json(client);
  });

  // Linking a report sheet, one marketplace at a time. A client selling on
  // both Amazon and Flipkart keeps a separate sheet for each — the figures
  // are per marketplace, and one sheet can't hold two accounts' numbers in
  // the same columns.
  router.post("/:id/report-sheets", requireRole(...MANAGE_ROLES), async (req, res) => {
    const { marketplace, sheetUrl } = req.body;
    if (typeof sheetUrl !== "string" || !sheetUrl.trim()) {
      res.status(400).json({ error: "Paste the link to the sheet." });
      return;
    }
    if (typeof marketplace !== "string" || !marketplace.trim()) {
      res.status(400).json({ error: "Pick which marketplace this sheet is for." });
      return;
    }

    // Checked against the live list, like every other marketplace value —
    // a sheet filed under a marketplace no dropdown offers could never be
    // picked to send, and would look like the link simply hadn't saved.
    const marketplaceOptions = await configOptionRepository.list("marketplace");
    if (!marketplaceOptions.some((option) => option.value === marketplace)) {
      res.status(400).json({ error: "That marketplace isn't on the list." });
      return;
    }

    const client = await clientRepository.findById(req.params.id);
    if (!client) {
      res.status(404).json({ error: "client not found" });
      return;
    }

    try {
      res.status(201).json(await clientRepository.addReportSheet(client.id, marketplace, sheetUrl.trim()));
    } catch (err: any) {
      if (err?.code === "P2002") {
        const label = marketplaceOptions.find((o) => o.value === marketplace)?.label ?? marketplace;
        res.status(409).json({
          error: `${client.name} already has a ${label} sheet. Remove that one first if you're replacing it.`,
        });
        return;
      }
      throw err;
    }
  });

  router.delete("/:id/report-sheets/:sheetId", requireRole(...MANAGE_ROLES), async (req, res) => {
    await clientRepository.removeReportSheet(req.params.sheetId);
    res.status(204).send();
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
      //
      // Which client is the whole answer. A group belongs to one client, so
      // the fix is either "unlink it there first" or "you already have it" —
      // and "already linked to a client" left staff hunting through 23 rows
      // to find out which. Two clients here are called Amezia and Amrezia,
      // and the same group had been typed into both.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        const owner = await clientRepository.findByGroupId(groupId.trim());
        res.status(409).json({
          error: owner
            ? owner.id === req.params.id
              ? `${owner.name} already has this WhatsApp group.`
              : `This WhatsApp group belongs to ${owner.name}. Unlink it there first, then add it here.`
            : "This WhatsApp group is already linked to a client.",
        });
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
function sheetFailure(err: unknown): { status: number; error: string; detail?: string } {
  // Whatever Google actually said, carried alongside every one of these. The
  // line above tells someone what to do; this tells them what happened, so a
  // cause none of these anticipated can still be acted on rather than met with
  // "couldn't read this sheet" and nothing else. Admin/manager screens only.
  const detail = sheetErrorDetail(err);

  switch (sheetProblemOf(err)) {
    case "not_shared":
      return {
        status: 502,
        detail,
        error:
          "This client's sheet isn't shared with the reports account yet. Open the sheet in Google Sheets, press Share, and give Viewer access to " +
          (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ?? "the reports account") + ".",
      };
    case "not_found":
      return {
        status: 502,
        detail,
        error: "That sheet link doesn't open. Check the Report Sheet link on the Clients screen.",
      };
    case "busy":
      return {
        status: 503,
        detail,
        error:
          "Google was busy, or too many sheets were read in the last minute. Wait a minute, then press Retry — " +
          "there's nothing wrong with this sheet.",
      };
    case "credentials":
      return {
        status: 502,
        detail,
        error: "The Google connection isn't working. This affects every client, not just this one — an admin should check Google Sheets setup.",
      };
    default:
      return {
        status: 502,
        detail,
        error: "Couldn't read this client's report sheet. Press Retry, and if it keeps happening check the link and sharing.",
      };
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
    const picked = pickReportSheet(client.reportSheets, req.query.marketplace);
    if ("error" in picked) {
      res.status(400).json({ error: picked.error });
      return;
    }

    try {
      const preview = await buildWeeklyReportPreview(picked.sheet.sheetUrl, new Date());
      res.json(preview);
    } catch (err) {
      console.error(`Failed to read report sheet for client ${client.id}:`, err);
      const failure = sheetFailure(err);
      res.status(failure.status).json({ error: failure.error, detail: failure.detail });
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
    const picked = pickReportSheet(client.reportSheets, req.query.marketplace);
    if ("error" in picked) {
      res.status(400).json({ error: picked.error });
      return;
    }

    try {
      res.json(await buildReport(picked.sheet.sheetUrl, req.params.kind, on ?? new Date()));
    } catch (err) {
      console.error(`Failed to read report sheet for client ${client.id}:`, err);
      const failure = sheetFailure(err);
      res.status(failure.status).json({ error: failure.error, detail: failure.detail });
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
