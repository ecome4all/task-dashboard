import { Request, Response, NextFunction } from "express";
import { authService } from "./authService";

declare global {
  namespace Express {
    interface Request {
      employeeId?: string;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.[authService.cookieName];
  const session = token ? authService.verifySession(token) : null;

  if (!session) {
    res.status(401).json({ error: "not authenticated" });
    return;
  }

  req.employeeId = session.employeeId;
  next();
}
