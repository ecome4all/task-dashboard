import { Router } from "express";
import { authService } from "../auth/authService";
import { employeeRepository } from "../repositories/employeeRepository";
import { requireAuth } from "../auth/requireAuth";

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

    const token = authService.signSession({ employeeId: employee.id });
    res.cookie(authService.cookieName, token, {
      ...authService.cookieOptions(),
      maxAge: authService.cookieMaxAgeMs,
    });
    res.json({ id: employee.id, name: employee.name, email: employee.email, role: employee.role });
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
