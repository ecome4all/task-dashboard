import { Router } from "express";
import { configOptionRepository } from "../repositories/configOptionRepository";
import { requireRole } from "../auth/requireRole";

const CATEGORIES = ["marketplace", "status", "task_type"];

export function createConfigOptionsRouter() {
  const router = Router();

  // Any logged-in employee — every dropdown that reads these (Marketplace,
  // Status, Type on the Task board) is open to any role.
  router.get("/:category", async (req, res) => {
    if (!CATEGORIES.includes(req.params.category)) {
      res.status(400).json({ error: "invalid category" });
      return;
    }
    res.json(await configOptionRepository.list(req.params.category));
  });

  // Admin-only: includes inactive options, for the Settings management view.
  router.get("/:category/all", requireRole("admin"), async (req, res) => {
    if (!CATEGORIES.includes(req.params.category)) {
      res.status(400).json({ error: "invalid category" });
      return;
    }
    res.json(await configOptionRepository.listAll(req.params.category));
  });

  router.post("/:category", requireRole("admin"), async (req, res) => {
    if (!CATEGORIES.includes(req.params.category)) {
      res.status(400).json({ error: "invalid category" });
      return;
    }
    const { label } = req.body;
    if (typeof label !== "string" || !label.trim()) {
      res.status(400).json({ error: "label is required" });
      return;
    }
    try {
      res.status(201).json(await configOptionRepository.create(req.params.category, label.trim()));
    } catch (err: any) {
      if (err?.code === "P2002") {
        res.status(400).json({ error: "an option with that name already exists" });
        return;
      }
      throw err;
    }
  });

  router.patch("/:category/:id", requireRole("admin"), async (req, res) => {
    const { label, active } = req.body;
    if (label !== undefined && (typeof label !== "string" || !label.trim())) {
      res.status(400).json({ error: "label must be a non-empty string" });
      return;
    }
    if (active !== undefined && typeof active !== "boolean") {
      res.status(400).json({ error: "active must be a boolean" });
      return;
    }
    const option = await configOptionRepository.update(req.params.id, {
      ...(label !== undefined && { label: label.trim() }),
      ...(active !== undefined && { active }),
    });
    res.json(option);
  });

  return router;
}
