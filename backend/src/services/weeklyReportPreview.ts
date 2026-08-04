import { extractSpreadsheetId, readTab, listTabNames, SheetTab } from "./googleSheets";
import {
  currentWeekNumber,
  currentMonthName,
  findWeeklyRowFields,
  findDailyRowsInWeek,
  findDailyRowForDate,
  findSkuRows,
  ReportField,
} from "./reportPeriod";
import { ensurePercentSuffix } from "./reportFormatting";

// The three reports that can be sent to a client, each reading its own tab
// of that client's sheet. "weekly_sales" is the original whole-account
// weekly summary; "weekly_sku" reads a per-SKU tab, which the older sheets
// don't have yet — a client whose sheet has no SKU tab simply produces no
// sections, the same way a missing Weekly or Daily tab already does.
export type ReportKind = "daily" | "weekly_sales" | "weekly_sku";

export const REPORT_KINDS: ReportKind[] = ["daily", "weekly_sales", "weekly_sku"];

export function isReportKind(value: unknown): value is ReportKind {
  return typeof value === "string" && (REPORT_KINDS as string[]).includes(value);
}

export const REPORT_KIND_LABEL: Record<ReportKind, string> = {
  daily: "Daily Report",
  weekly_sales: "Weekly Sales Report",
  weekly_sku: "Weekly SKU Report",
};

// Which tab belongs to which report, matched on the name's wording rather
// than one exact string. The same three tables have appeared under at least
// three naming schemes across versions of the client sheets:
//
//   "Daily"        "Daily Report"    "Daily Tracker"
//   "Weekly"       "Weekly Sales"    "Weekly Summary"
//   "SKU"          "Weekly SKU Sales"  "ASIN Weekly Breakdown"
//
// Hardcoding any one of those makes every report silently return nothing the
// moment a sheet uses a different wording — with no error, just an empty
// report. Matching on wording survives all three and the next rename too.
//
// Order matters: SKU is tested first because "Weekly SKU Sales" would
// otherwise be claimed by the weekly-sales rule, which also looks for "week".
export function pickTab(kind: ReportKind, tabNames: string[]): string | null {
  const isSku = (n: string) => /\b(sku|asin)\b/i.test(n);

  if (kind === "weekly_sku") {
    return tabNames.find(isSku) ?? null;
  }
  if (kind === "daily") {
    return tabNames.find((n) => /\bdaily\b/i.test(n) && !isSku(n)) ?? null;
  }
  // weekly_sales: a weekly tab that isn't the per-SKU one. "Monthly Summary"
  // and "Listing Optimisation Tracker" are deliberately not matched — no
  // report reads them.
  return tabNames.find((n) => /\bweek(ly)?\b/i.test(n) && !isSku(n)) ?? null;
}

// Exactly the columns from the agreed sample sheet, and nothing else.
//
// A master tab carries working columns a client must never see — a keyword
// column ("crime solving case files") was found sitting inside the Daily
// table and went out in a report. Whitelisting means a new column added to
// the master is ignored by default rather than quietly forwarded.
//
// The key column of each table (Date / Week / ASIN) is not listed: the
// finders already strip it, since it identifies the row rather than being
// one of its figures.
const REPORT_COLUMNS: Record<ReportKind, string[]> = {
  daily: [
    "Spend", "Order", "Sales", "Acos", "T.Order", "T.Sales", "T.Acos",
    "Ads Sales %", "Organic Sales %",
    "Active Listing", "Out of Stock Listing", "Inactive Listing/Blocked",
  ],
  weekly_sales: [
    "Spend", "Sales", "Acos", "T.Sales", "T.Acos", "Ads Sales %", "Organic Sales %",
  ],
  weekly_sku: [
    "Name", "Spend", "Order", "Sales", "Acos", "T.Order", "T.Sales", "T.Acos",
    "Ads Sales %", "Organic Sales %", "Rating", "Reviews", "FBA Units",
  ],
};

// Tolerant of spacing and capitalisation, since the same column is spelled
// "T.Acos" / "T.ACOS" / "t.acos " across sheets, but nothing beyond that —
// an unrecognised column is dropped, not guessed at.
function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/\s+/g, " ");
}

function onlyAgreedColumns(kind: ReportKind, fields: ReportField[]): ReportField[] {
  const allowed = new Set(REPORT_COLUMNS[kind].map(normalizeHeader));
  return fields.filter((f) => allowed.has(normalizeHeader(f.label)));
}

export interface ReportSection {
  // e.g. "Weekly — July, Week 2", "Daily — 2026-07-08" or "SKU TR04-B" —
  // lets the reviewing human tell which tab/period/SKU each block came from.
  source: string;
  fields: ReportField[];
}

export interface WeeklyReportPreview {
  week: number;
  month: string;
  sections: ReportSection[];
}

function withPercentSuffix(fields: ReportField[]): ReportField[] {
  return fields.map((f) => ({ ...f, value: ensurePercentSuffix(f.label, f.value) }));
}

// Resolves which tab this report should read from the spreadsheet's real tab
// list, then reads it. Returns null when the sheet has no tab for this
// report at all, which is a normal state — not every client's sheet carries
// every table.
async function readTabForKind(spreadsheetId: string, kind: ReportKind): Promise<SheetTab | null> {
  const tabNames = await listTabNames(spreadsheetId);
  const name = pickTab(kind, tabNames);
  return name ? readTab(spreadsheetId, name) : null;
}

function spreadsheetIdOrThrow(sheetUrl: string): string {
  const spreadsheetId = extractSpreadsheetId(sheetUrl);
  if (!spreadsheetId) {
    throw new Error("Couldn't find a spreadsheet id in the saved sheet link.");
  }
  return spreadsheetId;
}

// One report of one kind. Unlike buildWeeklyReportPreview below (which reads
// every tab at once for a human to review before a weekly send), this reads
// exactly the tab that report is about, so each of the three reports can be
// previewed and sent on its own.
export async function buildReport(
  sheetUrl: string,
  kind: ReportKind,
  referenceDate: Date
): Promise<WeeklyReportPreview> {
  const spreadsheetId = spreadsheetIdOrThrow(sheetUrl);
  const week = currentWeekNumber(referenceDate);
  const month = currentMonthName(referenceDate);
  const sections: ReportSection[] = [];

  const tab = await readTabForKind(spreadsheetId, kind);
  if (!tab) return { week, month, sections };

  if (kind === "daily") {
    const today = findDailyRowForDate(tab, referenceDate);
    const fields = today ? onlyAgreedColumns(kind, today.fields) : [];
    if (today && fields.length > 0) {
      sections.push({ source: `Daily — ${today.date}`, fields: withPercentSuffix(fields) });
    }
  } else if (kind === "weekly_sales") {
    const found = findWeeklyRowFields(tab, month, week);
    const fields = found ? onlyAgreedColumns(kind, found) : [];
    if (fields.length > 0) {
      sections.push({ source: `Weekly — ${month}, Week ${week}`, fields: withPercentSuffix(fields) });
    }
  } else {
    for (const row of findSkuRows(tab, month, week)) {
      const fields = onlyAgreedColumns(kind, row.fields);
      if (fields.length > 0) sections.push({ source: row.sku, fields: withPercentSuffix(fields) });
    }
  }

  return { week, month, sections };
}

// The combined read: the weekly and daily tables at once, for the Weekly
// Reports review screen and the Client Details panel. Unlike buildReport
// above it shows the whole current week of daily rows, not just today, since
// a human is reviewing before a weekly send.
//
// Resolves tab names the same way buildReport does — one listTabNames call
// shared across both tables rather than one per table.
export async function buildWeeklyReportPreview(sheetUrl: string, referenceDate: Date): Promise<WeeklyReportPreview> {
  const spreadsheetId = spreadsheetIdOrThrow(sheetUrl);

  const week = currentWeekNumber(referenceDate);
  const month = currentMonthName(referenceDate);
  const sections: ReportSection[] = [];
  const tabNames = await listTabNames(spreadsheetId);

  const weeklyName = pickTab("weekly_sales", tabNames);
  if (weeklyName) {
    const tab = await readTab(spreadsheetId, weeklyName);
    const fields = tab && findWeeklyRowFields(tab, month, week);
    if (fields && fields.length > 0) {
      sections.push({ source: `${weeklyName} — ${month}, Week ${week}`, fields: withPercentSuffix(fields) });
    }
  }

  const dailyName = pickTab("daily", tabNames);
  if (dailyName) {
    const tab = await readTab(spreadsheetId, dailyName);
    for (const day of tab ? findDailyRowsInWeek(tab, referenceDate) : []) {
      if (day.fields.length === 0) continue;
      sections.push({ source: `${dailyName} — ${day.date}`, fields: withPercentSuffix(day.fields) });
    }
  }

  return { week, month, sections };
}
