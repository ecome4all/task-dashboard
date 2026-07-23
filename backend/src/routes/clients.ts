import { Router } from "express";
import { clientRepository } from "../repositories/clientRepository";
import { unrecognizedMessageRepository } from "../repositories/unrecognizedMessageRepository";
import { requireRole } from "../auth/requireRole";
import { WhatsAppChannels } from "../whatsapp/resolveAdapter";

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

  // Hard delete — separate from the active/inactive toggle in PATCH above,
  // which is the reversible default. This is for actually removing a
  // mistaken or duplicate entry, not routine offboarding.
  router.delete("/:id", requireRole(...MANAGE_ROLES), async (req, res) => {
    await clientRepository.delete(req.params.id);
    res.status(204).send();
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
