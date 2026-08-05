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
export async function listTabNames(spreadsheetId: string): Promise<string[]> {
  const sheets = sheetsClient();
  const res = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties.title" });
  return (res.data.sheets ?? [])
    .map((s: any) => s.properties?.title)
    .filter((t: unknown): t is string => typeof t === "string");
}

// Reads one tab as its own header row + data rows, using Sheets'
// FORMATTED_VALUE render option -- the same text you'd see (and get) if you
// manually selected and copied the cell, e.g. "12.41%" stays "12.41%"
// instead of coming back as the underlying 0.1241. Returns null rather than
// throwing if the tab doesn't exist (a client's sheet may not have every
// known tab), so the caller can skip it instead of failing the whole read.
export async function readTab(spreadsheetId: string, tabName: string): Promise<SheetTab | null> {
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
}
