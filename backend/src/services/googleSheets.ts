import { google } from "googleapis";

// Matches both the long edit URL (".../spreadsheets/d/<id>/edit#gid=0") and a
// bare id typed in directly — staff paste whatever's in their browser's
// address bar, not a normalized form.
const SPREADSHEET_ID_PATTERN = /spreadsheets\/d\/([a-zA-Z0-9-_]+)/;

export function extractSpreadsheetId(urlOrId: string): string | null {
  const trimmed = urlOrId.trim();
  const match = trimmed.match(SPREADSHEET_ID_PATTERN);
  if (match) return match[1];
  // A bare id has no slashes or spaces -- if it's not a URL at all, assume
  // the whole trimmed string already is the id.
  return /^[a-zA-Z0-9-_]+$/.test(trimmed) ? trimmed : null;
}

export interface SheetTab {
  headers: string[];
  rows: string[][];
}

// A PEM private key has to survive being pasted into a hosting dashboard's
// variables box, and it frequently doesn't: .env strips the quotes around a
// value and a hosting UI keeps them, a one-line value holds its line breaks as
// literal "\n" while a pasted block holds real ones, and copying "the key"
// out of a document often takes the base64 body without the BEGIN/END lines.
// Each of those produces the same unhelpful failure deep inside OpenSSL
// ("error:1E08010C:DECODER routines::unsupported") with nothing pointing at
// the variable — and it cost a production outage of the report screens here,
// where the key had arrived as body-only with every line break flattened.
//
// So rather than trusting one exact form, this rebuilds the canonical PEM
// from whatever arrived: unquote, un-escape, take the base64 body, and wrap
// it back at 64 characters under the right header. What it can't do is
// invent a key that isn't there — an empty or non-base64 value still fails,
// just with a message that names the variable.
export function normalizePrivateKey(raw: string): string {
  let value = raw.trim();

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }

  // Env vars can't hold real newlines, so a one-line value spells them out.
  value = value.replace(/\\n/g, "\n");

  // Service-account keys are PKCS#8 ("PRIVATE KEY"); an older "RSA PRIVATE
  // KEY" is kept as-is rather than silently relabelled into something the
  // decoder would then reject.
  const label = /-----BEGIN ([A-Z ]+)-----/.exec(value)?.[1] ?? "PRIVATE KEY";
  const body = value
    .replace(/-----BEGIN [A-Z ]+-----/g, "")
    .replace(/-----END [A-Z ]+-----/g, "")
    .replace(/\s+/g, "");

  if (!body) {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY is set but contains no key — paste the whole key, including the BEGIN and END lines"
    );
  }

  const wrapped = body.match(/.{1,64}/g)!.join("\n");
  return `-----BEGIN ${label}-----\n${wrapped}\n-----END ${label}-----\n`;
}

// What actually went wrong reading a sheet. Worth distinguishing because the
// answer to each is completely different, and a message naming the wrong one
// sends staff hunting for a problem that isn't there — which is exactly what
// happened when every failure said "check it's shared".
export type SheetProblem = "not_shared" | "not_found" | "busy" | "credentials" | "unknown";

export class SheetReadError extends Error {
  constructor(public problem: SheetProblem, public cause?: unknown) {
    super(`sheet read failed: ${problem}`);
    this.name = "SheetReadError";
  }
}

// The HTTP status behind a failed call, whichever shape this version of the
// client reports it in.
//
// `code` used to be read first and used as-is. Newer googleapis puts a string
// there ("ERR_BAD_REQUEST") and keeps the number on `status`, so every 403
// arrived as a string, matched none of the checks below, and a sheet that
// simply hadn't been shared was reported to staff as an unexplained failure —
// the one message that names no cause and no fix.
//
// Numbers-only, from the most specific place first, ignoring anything that
// isn't one.
function statusOf(err: any): number | undefined {
  for (const candidate of [err?.response?.status, err?.status, err?.code]) {
    const value = typeof candidate === "string" ? Number(candidate) : candidate;
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return undefined;
}

// How Google words running out of the per-minute read allowance. Used twice
// below: to call it busy rather than a sharing problem, and to stop it being
// retried.
const QUOTA_WORDING = /quota|rate limit|rateLimitExceeded|RESOURCE_EXHAUSTED|too many requests/i;

export function classifySheetError(err: unknown): SheetProblem {
  const status = statusOf(err);
  const text = String((err as any)?.message ?? "");

  // Running the account out of its per-minute read allowance comes back as a
  // 403 at least as often as a 429 — so this is tested before the status, or
  // "out of quota" reads as "this sheet isn't shared" and sends staff to fix
  // sharing on sheets that are shared perfectly well. Reading two dozen
  // clients' sheets on one screen is exactly how the allowance runs out.
  if (QUOTA_WORDING.test(text)) return "busy";

  if (status === 403) return "not_shared";
  if (status === 404) return "not_found";
  if (status === 429 || (typeof status === "number" && status >= 500)) return "busy";
  // A bad key fails at the token exchange, before any request reaches Sheets,
  // so it arrives with no HTTP status of its own. Tested before the wording
  // checks below: a credentials failure is the whole app's problem, not one
  // sheet's, and must not be read as a sharing problem on one client.
  if (/DECODER|invalid_grant|private key|credential/i.test(text)) return "credentials";
  // Google's own wording, as a second way in. The status is the reliable
  // signal when it's there — this catches the shapes where it isn't, rather
  // than falling through to "unknown" and telling staff nothing.
  if (/permission|not have access|forbidden/i.test(text)) return "not_shared";
  if (/requested entity was not found|does not exist|no such spreadsheet/i.test(text)) return "not_found";
  if (/ECONNRESET|ETIMEDOUT|ENOTFOUND|socket hang up|network/i.test(text)) return "busy";
  return "unknown";
}

// What went wrong, asked of whatever the caller was handed.
//
// Every read leaves withRetry as a SheetReadError, which already carries the
// answer. Re-classifying that wrapper — which is what the routes did — starts
// again from an object with no HTTP status and the message "sheet read failed:
// not_shared", so every cause collapsed to "unknown" and staff were told
// "couldn't read this sheet" no matter what had actually happened. A
// credentials failure was the one exception, by accident: its wrapper message
// contains the word "credential".
//
// Callers should use this rather than classifySheetError directly.
export function sheetProblemOf(err: unknown): SheetProblem {
  return err instanceof SheetReadError ? err.problem : classifySheetError(err);
}

// What Google itself said, kept short and handed to the screen alongside the
// plain-English line.
//
// The plain line says what to do; this says what actually happened, so a cause
// nobody anticipated can still be acted on instead of being met with a shrug.
// The status is included when there is one — "403" versus "404" is often the
// whole diagnosis.
export function sheetErrorDetail(err: unknown): string | undefined {
  const original = err instanceof SheetReadError ? err.cause ?? err : err;
  const message = String((original as any)?.message ?? "").trim();
  const status = statusOf(original);

  if (!message && status === undefined) return undefined;

  // Google's messages run to several paragraphs of documentation links. The
  // first line is the part that names the cause.
  const firstLine = message.split("\n")[0]!.slice(0, 300);
  return status === undefined ? firstLine : `${status} — ${firstLine || "no message"}`;
}

// Whether trying again could plausibly work. Deliberately narrow: retrying a
// sheet that isn't shared just delays the same failure three times over.
//
// Running out of the per-minute allowance is the one "busy" that must NOT be
// retried. The waits below are under two seconds, so all a retry does is hit
// the same wall — and spend two more of the very requests that ran out. Every
// failing client was costing three.
function isTransient(err: unknown): boolean {
  if (QUOTA_WORDING.test(String((err as any)?.message ?? ""))) return false;
  return classifySheetError(err) === "busy";
}

const RETRY_DELAYS_MS = [400, 1200];

// Google answers a burst of reads unevenly — the Weekly Reports screen asks
// for every client at once, and on a cold process each of those is also
// waiting on the first access-token exchange. A few come back 429 or 503
// while the rest succeed, which is what put "couldn't read this sheet" next
// to perfectly healthy clients.
//
// Two retries with a growing pause turns that into a slower answer rather
// than a wrong one. Anything that isn't transient is rethrown immediately.
async function withRetry<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      return await operation();
    } catch (err) {
      lastError = err;
      if (!isTransient(err) || attempt === RETRY_DELAYS_MS.length) break;
      console.warn(`[sheets] transient failure, retrying in ${RETRY_DELAYS_MS[attempt]}ms:`, (err as any)?.message);
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
    }
  }
  throw new SheetReadError(classifySheetError(lastError), lastError);
}

let cachedClient: ReturnType<typeof google.sheets> | null = null;

// One authenticated client, reused across requests -- GoogleAuth caches and
// refreshes the underlying access token itself, so there's no need to
// re-authenticate per call.
function sheetsClient() {
  if (cachedClient) return cachedClient;
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  if (!email || !privateKey) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY are not set");
  }
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: email,
      // Rebuilt rather than trusted as-is — see normalizePrivateKey for the
      // several shapes this value arrives in depending on where it was pasted.
      private_key: normalizePrivateKey(privateKey),
    },
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  cachedClient = google.sheets({ version: "v4", auth });
  return cachedClient;
}

// Every tab name in the spreadsheet, in the order they appear. Needed
// because a report's tab can't be looked up by one fixed name — the same
// three tables have been seen called "Daily"/"Daily Report"/"Daily Tracker"
// across different versions of the client sheets. Callers match these names
// against a pattern instead (see pickTab in weeklyReportPreview.ts).
// Google allows 60 reads a minute per account. The Reports screen asks for
// every client at once, and each client costs two reads — the tab list, then
// the tab itself — so two dozen clients is 48 before anybody presses Refresh.
// A couple of reloads and every card on the screen turns into "Quota exceeded",
// which reads exactly like every sheet being broken at once.
//
// Tab names are the half worth keeping: a client's sheet is generated with its
// tabs and they are essentially never renamed, while the figures inside them
// change all day. Caching just this halves the reads and leaves the numbers
// live.
//
// In memory, so a restart clears it, and short enough that a genuinely renamed
// tab fixes itself within the hour without anyone being told to do anything.
const TAB_NAME_CACHE_MS = 10 * 60 * 1000;
const tabNameCache = new Map<string, { names: string[]; readAt: number }>();

export function forgetTabNames(spreadsheetId?: string): void {
  if (spreadsheetId) tabNameCache.delete(spreadsheetId);
  else tabNameCache.clear();
}

export async function listTabNames(spreadsheetId: string): Promise<string[]> {
  const cached = tabNameCache.get(spreadsheetId);
  if (cached && Date.now() - cached.readAt < TAB_NAME_CACHE_MS) return cached.names;

  return withRetry(async () => {
    const sheets = sheetsClient();
    const res = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties.title" });
    const names = (res.data.sheets ?? [])
      .map((s: any) => s.properties?.title)
      .filter((t: unknown): t is string => typeof t === "string");
    tabNameCache.set(spreadsheetId, { names, readAt: Date.now() });
    return names;
  });
}

// Reads one tab as its own header row + data rows, using Sheets'
// FORMATTED_VALUE render option -- the same text you'd see (and get) if you
// manually selected and copied the cell, e.g. "12.41%" stays "12.41%"
// instead of coming back as the underlying 0.1241. Returns null rather than
// throwing if the tab doesn't exist (a client's sheet may not have every
// known tab), so the caller can skip it instead of failing the whole read.
export async function readTab(spreadsheetId: string, tabName: string): Promise<SheetTab | null> {
  return withRetry(async () => {
  try {
    const sheets = sheetsClient();
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${tabName}'!A1:Z1000`,
      valueRenderOption: "FORMATTED_VALUE",
    });
    const values = res.data.values ?? [];
    if (values.length === 0) return { headers: [], rows: [] };
    const [headerRow, ...dataRows] = values;
    const headers = headerRow.map((h: unknown) => String(h ?? "").trim());
    const rows = dataRows.map((row: unknown[]) => headers.map((_, i) => String(row[i] ?? "")));
    return { headers, rows };
  } catch (err: any) {
    // A missing tab comes back as a 400 with "Unable to parse range" -- any
    // other failure (bad credentials, sheet not shared, network) should
    // surface, not be silently swallowed as "tab doesn't exist".
    if (err?.code === 400 || err?.response?.status === 400) return null;
    throw err;
  }
  });
}
