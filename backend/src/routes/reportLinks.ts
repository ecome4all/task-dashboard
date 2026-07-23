import { Router } from "express";
import { reportLinkRepository } from "../repositories/reportLinkRepository";
import { employeeRepository } from "../repositories/employeeRepository";
import { requireRole } from "../auth/requireRole";

// Report links no longer send their own message — a saved link is now
// attached into the single combined message composed on the Send Report
// screen (see ClientUpdate.tsx), which sends it via /api/clients/:id/send-update.
// This route just records that a link was used, for the "Last sent" column.
export function createReportLinksRouter() {
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

  router.post("/:id/mark-sent", requireRole("admin", "manager"), async (req, res) => {
    const reportLink = await reportLinkRepository.findById(req.params.id);
    if (!reportLink) {
      res.status(404).json({ error: "not found" });
      return;
    }

    const updated = await reportLinkRepository.markSent(reportLink.id);
    res.json(updated);
  });

  return router;
}
