import { Router } from "express";
import { requireRole } from "../auth/requireRole";
import { extractSpreadsheetId, listTabNames } from "../services/googleSheets";

// Why this exists: when a client's report sheet won't read, the route that
// failed answers with one deliberately vague line ("check it's shared with the
// service account and the link is correct"), and the real cause is only in the
// server log — which needs host access nobody has at the moment they're
// looking at the screen. In practice the cause is almost never the sheet: it's
// the service-account credentials on the host, pasted in a form that doesn't
// survive (quotes included by accident, or the key's line breaks flattened).
//
// So this reports the *shape* of those credentials and the error Google itself
// returned, which is enough to tell "not set" from "pasted wrong" from "sheet
// genuinely not shared" from outside the box.
//
// It never returns key material — only whether it's there and what form it's
// in. The service-account email is not a secret: it's the address a sheet has
// to be shared with for any of this to work at all.
export function createDiagnosticsRouter(): Router {
  const router = Router();

  router.get("/google-sheets", requireRole("admin"), async (req, res) => {
    const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ?? null;
    const rawKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY ?? "";

    // A value pasted into a host's variables box with its surrounding quotes
    // kept is the most common way this breaks: .env strips those quotes, a
    // hosting dashboard does not, so they end up inside the key itself.
    const trimmed = rawKey.trim();
    const wrappedInQuotes =
      (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"));

    const privateKey = {
      set: rawKey.length > 0,
      length: rawKey.length,
      // The key is only usable as a PEM: header, footer, and line breaks in
      // between — held either as literal "\n" (what a one-line variable
      // should contain, and what googleSheets.ts un-escapes) or as real ones.
      startsWithHeader: trimmed.replace(/^["']/, "").startsWith("-----BEGIN"),
      endsWithFooter: trimmed.replace(/["']$/, "").endsWith("-----END PRIVATE KEY-----"),
      escapedNewlines: (rawKey.match(/\\n/g) ?? []).length,
      realNewlines: (rawKey.match(/\n/g) ?? []).length,
      wrappedInQuotes,
    };

    // Optional: actually try a read, and pass back what Google said. Takes a
    // full sheet URL or a bare id, so a specific client's sheet can be tested
    // rather than only the credentials in the abstract.
    let liveRead: unknown = "not attempted — pass ?sheet=<url or id> to try a real read";
    const sheet = typeof req.query.sheet === "string" ? req.query.sheet : null;
    if (sheet) {
      const spreadsheetId = extractSpreadsheetId(sheet);
      if (!spreadsheetId) {
        liveRead = { ok: false, reason: "that doesn't look like a sheet link or id" };
      } else {
        try {
          liveRead = { ok: true, spreadsheetId, tabs: await listTabNames(spreadsheetId) };
        } catch (err: any) {
          liveRead = {
            ok: false,
            spreadsheetId,
            code: err?.code ?? null,
            // Google's own wording is the useful part ("Method doesn't allow
            // unregistered callers", "The caller does not have permission",
            // "error:1E08010C:DECODER routines::unsupported" for a mangled
            // key). Capped so a stack trace can't flood the response.
            message: String(err?.message ?? err).slice(0, 500),
          };
        }
      }
    }

    res.json({ serviceAccountEmail: email, privateKey, liveRead });
  });

  return router;
}
