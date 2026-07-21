import { Router } from "express";
import { clientRepository } from "../repositories/clientRepository";
import { taskRepository } from "../repositories/taskRepository";
import { requireRole } from "../auth/requireRole";
import { WhatsAppChannels } from "../whatsapp/resolveAdapter";

// Same audience as report-links: admins and supervisors are the ones who
// send reports to clients, so they're the ones who maintain the directory.
const MANAGE_ROLES = ["admin", "supervisor"];

export function createClientsRouter(channels: WhatsAppChannels) {
  const router = Router();

  router.get("/", requireRole(...MANAGE_ROLES), async (_req, res) => {
    res.json(await clientRepository.list());
  });

  router.get("/all", requireRole(...MANAGE_ROLES), async (_req, res) => {
    res.json(await clientRepository.listAll());
  });

  // Groups seen on incoming WhatsApp-group tasks that aren't tied to any
  // client yet — staff assign these manually via PATCH /:id, nothing here
  // is auto-matched. First occurrence per group (rows are newest-first) also
  // gives us the most recently seen chat_name and task count.
  router.get("/unlinked-groups", requireRole(...MANAGE_ROLES), async (_req, res) => {
    const [rows, linkedIds] = await Promise.all([taskRepository.listGroupSources(), clientRepository.linkedGroupIds()]);

    const groups = new Map<string, { chatId: string; chatName: string | null; taskCount: number; lastSeenAt: Date }>();
    for (const row of rows) {
      if (linkedIds.has(row.sourceRef)) continue;
      const existing = groups.get(row.sourceRef);
      if (existing) {
        existing.taskCount += 1;
      } else {
        groups.set(row.sourceRef, {
          chatId: row.sourceRef,
          chatName: row.chatName,
          taskCount: 1,
          lastSeenAt: row.createdAt,
        });
      }
    }

    res.json([...groups.values()].sort((a, b) => b.lastSeenAt.getTime() - a.lastSeenAt.getTime()));
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
    const { name, phone, whatsappGroupId, whatsappGroupName, notes, active } = req.body;
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
      ...(whatsappGroupId !== undefined && { whatsappGroupId }),
      ...(whatsappGroupName !== undefined && { whatsappGroupName }),
      ...(notes !== undefined && { notes }),
      ...(active !== undefined && { active }),
    });
    res.json(client);
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

    await channels[channel as "whapi" | "official"].sendMessage(phone.trim(), message.trim());
    res.json({ sent: true });
  });

  return router;
}
