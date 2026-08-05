import { Router } from "express";
import { authService } from "../auth/authService";
import { employeeRepository } from "../repositories/employeeRepository";
import { requireAuth } from "../auth/requireAuth";
import { passwordProblem } from "../auth/credentialRules";

export function createAuthRouter() {
  const router = Router();

  router.post("/login", async (req, res) => {
    const { email, password } = req.body;
    if (typeof email !== "string" || typeof password !== "string") {
      res.status(400).json({ error: "email and password are required" });
      return;
    }

    const employee = await employeeRepository.findByEmail(email);
    if (!employee?.passwordHash || !(await authService.verifyPassword(password, employee.passwordHash))) {
      res.status(401).json({ error: "invalid email or password" });
      return;
    }

    // A deactivated employee must not get a session at all. Without this,
    // "Deactivate" only ever blocked the role-gated screens (Clients,
    // Employees, Settings) — the person could still log in and read and edit
    // the whole task board, which is behind requireAuth alone. Worded the
    // same as a wrong password on purpose: which accounts still exist isn't
    // something an unauthenticated caller needs told.
    if (!employee.active) {
      res.status(401).json({ error: "invalid email or password" });
      return;
    }

    const token = authService.signSession({ employeeId: employee.id });
    res.cookie(authService.cookieName, token, {
      ...authService.cookieOptions(),
      maxAge: authService.cookieMaxAgeMs,
    });
    res.json({ id: employee.id, name: employee.name, email: employee.email, role: employee.role });
  });

  // Anyone changing their own password. Not admin-only and not admin-visible:
  // an admin sets the *first* password (see PUT /api/employees/:id/login) and
  // the person is expected to change it here, so the one an admin knows stops
  // being the one that works.
  //
  // The current password is required even though the session already proves
  // who this is — it's what stops an unattended logged-in browser from being
  // turned into a permanent account takeover.
  router.post("/change-password", requireAuth, async (req, res) => {
    const { currentPassword, newPassword } = req.body;

    if (typeof currentPassword !== "string") {
      res.status(400).json({ error: "Enter your current password." });
      return;
    }
    const problem = passwordProblem(newPassword);
    if (problem) {
      res.status(400).json({ error: problem });
      return;
    }

    const employee = await employeeRepository.findById(req.employeeId!);
    if (!employee?.passwordHash) {
      res.status(403).json({ error: "This account has no password set." });
      return;
    }
    if (!(await authService.verifyPassword(currentPassword, employee.passwordHash))) {
      res.status(400).json({ error: "That's not your current password." });
      return;
    }

    await employeeRepository.setPassword(employee.id, await authService.hashPassword(newPassword));
    // Sessions are signed JWTs with no revocation list, so every session
    // already issued for this account — including any on another device —
    // stays valid until it expires on its own. Worth knowing if a password is
    // ever changed because it leaked rather than as routine hygiene.
    console.log(`[auth] password changed for ${employee.name}`);
    res.status(204).send();
  });

  router.post("/logout", (_req, res) => {
    res.clearCookie(authService.cookieName, authService.cookieOptions());
    res.status(204).send();
  });

  router.get("/me", requireAuth, async (req, res) => {
    const employee = await employeeRepository.findById(req.employeeId!);
    if (!employee) {
      res.status(401).json({ error: "not authenticated" });
      return;
    }
    res.json({ id: employee.id, name: employee.name, email: employee.email, role: employee.role });
  });

  return router;
}
