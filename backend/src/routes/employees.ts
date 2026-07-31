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
    const { role, active, phone, name } = req.body;
    if (name !== undefined && (typeof name !== "string" || !name.trim())) {
      res.status(400).json({ error: "name can't be empty" });
      return;
    }
    if (role !== undefined && !ROLES.includes(role)) {
      res.status(400).json({ error: "invalid role" });
      return;
    }
    if (active !== undefined && typeof active !== "boolean") {
      res.status(400).json({ error: "active must be a boolean" });
      return;
    }
    if (phone !== undefined && typeof phone !== "string") {
      res.status(400).json({ error: "phone must be text" });
      return;
    }
    // Without this, an admin could demote or deactivate their own only
    // admin account and lock themselves (and everyone else) out.
    if (req.params.id === req.employeeId && ((role && role !== "admin") || active === false)) {
      res.status(400).json({ error: "you can't remove your own admin access" });
      return;
    }

    // Renaming is its own operation, not just another column: it has to
    // carry the person's existing tasks over to the new name (see
    // employeeRepository.rename). Done first so a request that changes both
    // name and role doesn't half-apply if the name turns out to clash.
    if (name !== undefined) {
      const newName = name.trim();
      const clash = await employeeRepository.findByName(newName, req.params.id);
      if (clash) {
        res.status(409).json({
          error: `${clash.name} already uses that name. Tasks record who they're for by name, so two people can't share one.`,
        });
        return;
      }

      const renamed = await employeeRepository.rename(req.params.id, newName);
      if (!renamed) {
        res.status(404).json({ error: "employee not found" });
        return;
      }
      console.log(
        `[employees] renamed to "${newName}" — moved ${renamed.tasksMoved} task(s) and ${renamed.repeatsMoved} repeat(s)`
      );
    }

    const employee = await employeeRepository.update(req.params.id, { role, active, phone });
    res.json(employee);
  });

  return router;
}
