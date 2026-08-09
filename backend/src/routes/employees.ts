import { Router } from "express";
import { employeeRepository } from "../repositories/employeeRepository";
import { requireRole } from "../auth/requireRole";
import { authService } from "../auth/authService";
import { isValidEmail, passwordProblem } from "../auth/credentialRules";
import { whyEmployeeCannotBeDeleted } from "../services/employeeDeletion";

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

  // Gives an employee a way to sign in, or replaces the login they have.
  // Admin-only, and the only route in the app that creates one — there is no
  // public sign-up, by design. The admin hands the password over themselves;
  // nothing here emails or WhatsApps it, since a password sitting in a chat
  // thread is a password anyone who later opens that phone can read.
  router.put("/:id/login", requireRole("admin"), async (req, res) => {
    const { email, password } = req.body;

    if (typeof email !== "string" || !isValidEmail(email)) {
      res.status(400).json({ error: "That doesn't look like an email address." });
      return;
    }
    const problem = passwordProblem(password);
    if (problem) {
      res.status(400).json({ error: problem });
      return;
    }

    const employee = await employeeRepository.findById(req.params.id);
    if (!employee) {
      res.status(404).json({ error: "employee not found" });
      return;
    }

    // Email is the login name, so two people can't share one. Checked here
    // rather than left to the unique index so the answer says which of the
    // two things went wrong.
    const clash = await employeeRepository.findByEmail(email);
    if (clash && clash.id !== employee.id) {
      res.status(409).json({ error: `${clash.name} already logs in with that email.` });
      return;
    }

    const updated = await employeeRepository.setLogin(
      employee.id,
      email,
      await authService.hashPassword(password)
    );
    console.log(`[employees] set login for ${updated.name} <${updated.email}>`);
    res.json(updated);
  });

  // Takes sign-in access away without deleting the person: they keep their
  // name, their tasks and their WhatsApp messages, they just can't log in.
  // (Deactivating, next to this, stops both at once.)
  router.delete("/:id/login", requireRole("admin"), async (req, res) => {
    // Without this an admin could remove their own login and be locked out
    // with no way back in — same reasoning as the self-demotion guard above.
    if (req.params.id === req.employeeId) {
      res.status(400).json({ error: "you can't remove your own login" });
      return;
    }

    const employee = await employeeRepository.findById(req.params.id);
    if (!employee) {
      res.status(404).json({ error: "employee not found" });
      return;
    }

    res.json(await employeeRepository.clearLogin(employee.id));
  });

  // Removing someone outright, for a duplicate or a test account. Someone who
  // has actually left should be deactivated instead: that stops their login
  // and their messages while keeping their name attached to the work they
  // did. Deleting is for rows that should never have existed.
  //
  // Their past work is unaffected either way — a task stores the assignee's
  // name, not a link to this row.
  router.delete("/:id", requireRole("admin"), async (req, res) => {
    const employee = await employeeRepository.findById(req.params.id);
    if (!employee) {
      res.status(404).json({ error: "employee not found" });
      return;
    }

    const refusal = whyEmployeeCannotBeDeleted({
      isSelf: employee.id === req.employeeId,
      targetIsActiveAdmin: employee.active && employee.role === "admin",
      otherActiveAdmins: await employeeRepository.countOtherActiveAdmins(employee.id),
    });
    if (refusal) {
      res.status(400).json({ error: refusal });
      return;
    }

    await employeeRepository.delete(employee.id);
    console.log(`[employees] deleted ${employee.name}`);
    res.status(204).send();
  });

  return router;
}
