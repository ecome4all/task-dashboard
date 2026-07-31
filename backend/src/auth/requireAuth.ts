import { Request, Response, NextFunction } from "express";
import { authService } from "./authService";
import { employeeRepository } from "../repositories/employeeRepository";

// The employee row behind the current session, looked up once per request in
// requireAuth and reused by requireRole — otherwise every role-gated route
// would fetch the same row twice.
export interface SessionEmployee {
  id: string;
  name: string;
  role: string;
  active: boolean;
}

declare global {
  namespace Express {
    interface Request {
      employeeId?: string;
      employee?: SessionEmployee;
    }
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.[authService.cookieName];
  const session = token ? authService.verifySession(token) : null;

  if (!session) {
    res.status(401).json({ error: "not authenticated" });
    return;
  }

  // Checked fresh on every request rather than trusted from the token, so
  // deactivating someone (or deleting them) ends their access immediately
  // instead of whenever their existing cookie happens to expire — the same
  // rule requireRole already applies to a demotion. Before this, a session
  // issued before deactivation kept full access to the task board.
  const employee = await employeeRepository.findById(session.employeeId);
  if (!employee || !employee.active) {
    res.status(401).json({ error: "not authenticated" });
    return;
  }

  req.employeeId = employee.id;
  req.employee = { id: employee.id, name: employee.name, role: employee.role, active: employee.active };
  next();
}
