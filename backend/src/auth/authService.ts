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

// Frontend and backend live on different domains in production (Vercel +
// Railway), so the session cookie must be SameSite=None + Secure to be sent
// on cross-origin requests at all. Locally, both run on localhost over
// plain HTTP, where Secure cookies are silently dropped — so this only
// switches on when NODE_ENV=production.
function cookieOptions() {
  const isProduction = process.env.NODE_ENV === "production";
  return {
    httpOnly: true as const,
    sameSite: (isProduction ? "none" : "lax") as "none" | "lax",
    secure: isProduction,
  };
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
  cookieOptions,
};
