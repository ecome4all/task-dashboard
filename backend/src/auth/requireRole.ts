import { Request, Response, NextFunction } from "express";
import { employeeRepository } from "../repositories/employeeRepository";

// Looks up the employee's *current* role on every request rather than
// trusting a role baked into the session token, so a demotion (or
// deactivation) takes effect immediately instead of on next login.
export function requireRole(...allowedRoles: string[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    // requireAuth runs first on every /api route and has already fetched
    // this row fresh, so reuse it rather than querying the same primary key
    // twice per request. Falls back to its own lookup if this middleware is
    // ever mounted somewhere requireAuth didn't run.
    const employee = req.employee ?? (req.employeeId ? await employeeRepository.findById(req.employeeId) : null);

    if (!employee || !employee.active || !allowedRoles.includes(employee.role)) {
      res.status(403).json({ error: "insufficient permissions" });
      return;
    }

    next();
  };
}
