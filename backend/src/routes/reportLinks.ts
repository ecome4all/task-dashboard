import { Router } from "express";
import { reportLinkRepository } from "../repositories/reportLinkRepository";
import { employeeRepository } from "../repositories/employeeRepository";
import { composeReportMessage } from "../services/composeReportMessage";
import { requireRole } from "../auth/requireRole";
import { WhatsAppChannels } from "../whatsapp/resolveAdapter";

export function createReportLinksRouter(channels: WhatsAppChannels) {
  const router = Router();

  router.get("/", requireRole("admin", "manager"), async (_req, res) => {
    res.json(await reportLinkRepository.list());
  });

  router.post("/", requireRole("admin", "manager"), async (req, res) => {
    const { description, url } = req.body;
    if (typeof description !== "string" || !description.trim() || typeof url !== "string" || !url.trim()) {
      res.status(400).json({ error: "description and url are required" });
      return;
    }

    const creator = await employeeRepository.findById(req.employeeId!);
    const reportLink = await reportLinkRepository.create(description.trim(), url.trim(), creator?.name ?? "Unknown");
    res.status(201).json(reportLink);
  });

  router.post("/:id/send", requireRole("admin", "manager"), async (req, res) => {
    const { phone, channel } = req.body;
    if (typeof phone !== "string" || !phone.trim() || (channel !== "whapi" && channel !== "official")) {
      res.status(400).json({ error: "phone and channel ('whapi' or 'official') are required" });
      return;
    }

    const reportLink = await reportLinkRepository.findById(req.params.id);
    if (!reportLink) {
      res.status(404).json({ error: "not found" });
      return;
    }

    const whatsapp = channels[channel as "whapi" | "official"];
    try {
      await whatsapp.sendMessage(phone.trim(), composeReportMessage(reportLink.description, reportLink.url));
    } catch (err) {
      // A failed send (network blip, bad number, provider outage) must not
      // crash the server — an uncaught rejection here would take down the
      // whole process, not just this one request. The user asked us to
      // send something, so unlike a status-update notification, report the
      // failure back instead of silently marking it sent.
      console.error("Failed to send report link:", err);
      res.status(502).json({ error: "Couldn't send the message. Try again." });
      return;
    }

    const updated = await reportLinkRepository.markSent(reportLink.id);
    res.json(updated);
  });

  return router;
}
