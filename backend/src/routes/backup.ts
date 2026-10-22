import crypto from "crypto";
import { Router } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../db";

// A full, read-only export of every row, fetched once a week by an Apps Script
// in the client's own Google account and saved to their Drive. It lives there
// rather than anywhere of ours because it is their data: the copy must not
// depend on a developer's machine being switched on, or on the developer.
//
// Why a pull from Apps Script and not a push from here: the service account
// that reads report sheets has no Drive storage of its own, so it cannot save
// a file into a personal Gmail's Drive. The script runs as the client and
// uses their storage.
//
// Not behind requireAuth — the caller is a script, not a logged-in browser —
// so it is guarded by its own token instead, and FAILS CLOSED: with
// BACKUP_TOKEN unset or too short the route does not exist. The export holds
// every client's details and every employee's password hash; a restore needs
// those hashes, or everybody's login stops working.
const MIN_TOKEN_LENGTH = 32;

export function isAuthorizedBackupRequest(authHeader: string | undefined, token: string | undefined): boolean {
  if (!token || token.length < MIN_TOKEN_LENGTH || !authHeader) return false;
  const expected = Buffer.from(`Bearer ${token}`, "utf8");
  const given = Buffer.from(authHeader, "utf8");
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

// Every model in the schema, so a table added later is exported without
// anyone remembering to add it here.
export function modelKeys(): string[] {
  return Prisma.dmmf.datamodel.models.map((m) => m.name[0].toLowerCase() + m.name.slice(1));
}

export function createBackupRouter(): Router {
  const router = Router();

  router.get("/", async (req, res) => {
    const token = process.env.BACKUP_TOKEN;
    if (!token || token.length < MIN_TOKEN_LENGTH) return res.status(404).end();
    if (!isAuthorizedBackupRequest(req.get("authorization"), token)) return res.status(401).end();

    try {
      const out: Record<string, unknown> = {};
      for (const key of modelKeys()) {
        out[key] = await (prisma as any)[key].findMany();
      }
      out._meta = {
        takenAt: new Date().toISOString(),
        note: "Full row export via Prisma. Read-only operation.",
      };
      res.setHeader("Cache-Control", "no-store");
      res.json(out);
    } catch (err) {
      console.error("Backup export failed:", err);
      res.status(500).json({ error: "Backup export failed" });
    }
  });

  return router;
}
