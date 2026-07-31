import { extractSpreadsheetId, readTab, SheetTab } from "./googleSheets";
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

// Candidate tab names per report, tried in order. readTab builds a literal
// A1 range ('<name>'!A1:Z1000), so the name has to actually match — rather
// than rely on the Sheets API's range parsing being case-insensitive (which
// isn't something to bet a client's report on), the likely spellings are
// tried explicitly. First tab that exists wins.
const KIND_TABS: Record<ReportKind, string[]> = {
  daily: ["Daily", "daily", "DAILY"],
  weekly_sales: ["Weekly", "weekly", "WEEKLY"],
  weekly_sku: ["SKU", "Sku", "sku", "SKUs", "SKU Report"],
};

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

async function readFirstTab(spreadsheetId: string, names: string[]): Promise<SheetTab | null> {
  for (const name of names) {
    const tab = await readTab(spreadsheetId, name);
    if (tab) return tab;
  }
  return null;
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

  const tab = await readFirstTab(spreadsheetId, KIND_TABS[kind]);
  if (!tab) return { week, month, sections };

  if (kind === "daily") {
    const today = findDailyRowForDate(tab, referenceDate);
    if (today && today.fields.length > 0) {
      sections.push({ source: `Daily — ${today.date}`, fields: withPercentSuffix(today.fields) });
    }
  } else if (kind === "weekly_sales") {
    const fields = findWeeklyRowFields(tab, month, week);
    if (fields && fields.length > 0) {
      sections.push({ source: `Weekly — ${month}, Week ${week}`, fields: withPercentSuffix(fields) });
    }
  } else {
    for (const row of findSkuRows(tab, month, week)) {
      sections.push({ source: row.sku, fields: withPercentSuffix(row.fields) });
    }
  }

  return { week, month, sections };
}

// The original combined read: every configured tab at once, for the Weekly
// Reports review screen. Kept as-is so that screen and the Client Details
// panel keep working unchanged — buildReport above is what the three
// individual reports use.
const REPORT_TABS: { name: string; kind: "weekly" | "daily" }[] = [
  { name: "Weekly", kind: "weekly" },
  { name: "Daily", kind: "daily" },
];

export async function buildWeeklyReportPreview(sheetUrl: string, referenceDate: Date): Promise<WeeklyReportPreview> {
  const spreadsheetId = spreadsheetIdOrThrow(sheetUrl);

  const week = currentWeekNumber(referenceDate);
  const month = currentMonthName(referenceDate);
  const sections: ReportSection[] = [];

  for (const tabConfig of REPORT_TABS) {
    const tab = await readTab(spreadsheetId, tabConfig.name);
    if (!tab) continue;

    if (tabConfig.kind === "weekly") {
      const fields = findWeeklyRowFields(tab, month, week);
      if (fields && fields.length > 0) {
        sections.push({ source: `${tabConfig.name} — ${month}, Week ${week}`, fields: withPercentSuffix(fields) });
      }
    } else {
      for (const day of findDailyRowsInWeek(tab, referenceDate)) {
        if (day.fields.length === 0) continue;
        sections.push({ source: `${tabConfig.name} — ${day.date}`, fields: withPercentSuffix(day.fields) });
      }
    }
  }

  return { week, month, sections };
}
