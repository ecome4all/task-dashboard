import { Router } from "express";
import { employeeRepository } from "../repositories/employeeRepository";
import { requireRole } from "../auth/requireRole";

export function createEmployeesRouter() {
  const router = Router();

  router.get("/", async (_req, res) => {
    res.json(await employeeRepository.list());
  });

  router.post("/", requireRole("admin"), async (req, res) => {
    const { name } = req.body;
    if (typeof name !== "string" || !name.trim()) {
      res.status(400).json({ error: "name is required" });
      return;
    }
    res.status(201).json(await employeeRepository.create(name.trim()));
  });

  return router;
}
