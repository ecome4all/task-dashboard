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
      // Env vars can't hold real newlines -- the key is stored with literal
      // "\n" escape sequences and unescaped here before use.
      private_key: privateKey.replace(/\\n/g, "\n"),
    },
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  cachedClient = google.sheets({ version: "v4", auth });
  return cachedClient;
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
