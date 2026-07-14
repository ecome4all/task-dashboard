import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const SESSION_COOKIE = "session";
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET is not set — required to sign/verify sessions");
  }
  return secret;
}

export interface SessionPayload {
  employeeId: string;
}

export const authService = {
  hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, 10);
  },

  verifyPassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  },

  signSession(payload: SessionPayload): string {
    return jwt.sign(payload, getJwtSecret(), { expiresIn: "7d" });
  },

  verifySession(token: string): SessionPayload | null {
    try {
      return jwt.verify(token, getJwtSecret()) as SessionPayload;
    } catch {
      return null;
    }
  },

  cookieName: SESSION_COOKIE,
  cookieMaxAgeMs: SESSION_MAX_AGE_MS,
};
