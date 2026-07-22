import { Router } from "express";
import { employeeRepository } from "../repositories/employeeRepository";
import { requireRole } from "../auth/requireRole";

const ROLES = ["admin", "manager", "member"];

export function createEmployeesRouter() {
  const router = Router();

  router.get("/", async (_req, res) => {
    res.json(await employeeRepository.list());
  });

  // Admin-only: the employee-management panel needs inactive employees too
  // (to reactivate them), unlike the assignee dropdown everyone else uses.
  router.get("/all", requireRole("admin"), async (_req, res) => {
    res.json(await employeeRepository.listAll());
  });

  router.post("/", requireRole("admin"), async (req, res) => {
    const { name } = req.body;
    if (typeof name !== "string" || !name.trim()) {
      res.status(400).json({ error: "name is required" });
      return;
    }
    res.status(201).json(await employeeRepository.create(name.trim()));
  });

  router.patch("/:id", requireRole("admin"), async (req, res) => {
    const { role, active } = req.body;
    if (role !== undefined && !ROLES.includes(role)) {
      res.status(400).json({ error: "invalid role" });
      return;
    }
    if (active !== undefined && typeof active !== "boolean") {
      res.status(400).json({ error: "active must be a boolean" });
      return;
    }
    // Without this, an admin could demote or deactivate their own only
    // admin account and lock themselves (and everyone else) out.
    if (req.params.id === req.employeeId && ((role && role !== "admin") || active === false)) {
      res.status(400).json({ error: "you can't remove your own admin access" });
      return;
    }

    const employee = await employeeRepository.updateRoleAndActive(req.params.id, { role, active });
    res.json(employee);
  });

  return router;
}
