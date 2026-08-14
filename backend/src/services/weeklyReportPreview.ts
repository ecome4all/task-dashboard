import { extractSpreadsheetId, readTab, listTabNames, SheetTab } from "./googleSheets";
import {
  currentWeekNumber,
  currentMonthName,
  findWeeklyRowFields,
  findDailyRowsInWeek,
  findDailyRowForDate,
  findSkuRows,
  findMonthlyRowFields,
  ReportField,
} from "./reportPeriod";
import { ensurePercentSuffix } from "./reportFormatting";

// The three reports that can be sent to a client, each reading its own tab
// of that client's sheet. "weekly_sales" is the original whole-account
// weekly summary; "weekly_sku" reads a per-SKU tab, which the older sheets
// don't have yet — a client whose sheet has no SKU tab simply produces no
// sections, the same way a missing Weekly or Daily tab already does.
export type ReportKind = "daily" | "weekly_sales" | "weekly_sku" | "monthly";

export const REPORT_KINDS: ReportKind[] = ["daily", "weekly_sales", "weekly_sku", "monthly"];

export function isReportKind(value: unknown): value is ReportKind {
  return typeof value === "string" && (REPORT_KINDS as string[]).includes(value);
}

export const REPORT_KIND_LABEL: Record<ReportKind, string> = {
  daily: "Daily Report",
  weekly_sales: "Weekly Sales Report",
  weekly_sku: "Weekly SKU Report",
  monthly: "Monthly Report",
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
  if (kind === "monthly") {
    return tabNames.find((n) => /\bmonth(ly)?\b/i.test(n) && !isSku(n)) ?? null;
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
  // "Target Achieved" and "Keyword" sit in this table on the master and are
  // internal — deliberately not listed, so they never reach a client.
  monthly: [
    "Spend", "Order", "Sales", "Acos", "T.Order", "T.Sales", "T.Acos",
    "Ads Sales %", "Organic Sales %",
  ],
};

// The same figure is headed differently from one table to the next in the real
// sheets. The Monthly Summary writes "Ad Orders", "Ad Sales", "T.Orders" and
// "Ad Sales %" where the Daily table writes "Order", "Sales", "T.Order" and
// "Ads Sales %".
//
// Matching the daily wording alone is why a monthly report went out with three
// lines in it — Acos, T.Sales and T.Acos, the only three spelled the same in
// both — with the spend and the sales silently missing. The client's own
// wording is still what they are shown; this only decides whether a column is
// one of the agreed ones.
//
// Deliberately a list of known spellings rather than fuzzy matching: a column
// nobody has seen before must stay out of a client's report, which is the
// whole point of the whitelist below.
const HEADER_ALIASES: Record<string, string> = {
  "ad order": "order",
  "ad orders": "order",
  orders: "order",
  "ad sale": "sales",
  "ad sales": "sales",
  "t.orders": "t.order",
  "t. orders": "t.order",
  "t. order": "t.order",
  "t. sales": "t.sales",
  "t. acos": "t.acos",
  "ad sales %": "ads sales %",
  "ad sales%": "ads sales %",
  "ads sales%": "ads sales %",
  "organic sales%": "organic sales %",
};

// Tolerant of spacing and capitalisation, since the same column is spelled
// "T.Acos" / "T.ACOS" / "t.acos " across sheets, and of the known alternative
// wordings above — but nothing beyond that. An unrecognised column is dropped,
// not guessed at.
function normalizeHeader(header: string): string {
  const cleaned = header.trim().toLowerCase().replace(/\s+/g, " ");
  return HEADER_ALIASES[cleaned] ?? cleaned;
}

export function onlyAgreedColumns(kind: ReportKind, fields: ReportField[]): ReportField[] {
  const allowed = new Set(REPORT_COLUMNS[kind].map(normalizeHeader));
  return fields.filter((f) => allowed.has(normalizeHeader(f.label)));
}

// Agreed columns that this client's sheet HAS, but which didn't survive into
// the report. A cell that is blank, or holds a spreadsheet error, is dropped
// on the way in — see usableFields in reportPeriod.ts — and until now that
// happened in silence: the report simply came out with fewer lines than usual
// and nobody sending it had any way to notice.
//
// That is how a set of reports went out with Acos and T.Acos missing for a few
// clients. Acos is spend ÷ sales, so a client with no sales in the period gets
// #DIV/0!, and both columns vanish while everything else looks normal.
//
// Compared against the sheet's own headers, not just against the agreed list:
// an older client sheet that never had a Rating or FBA Units column is not
// leaving anything out, and saying so on every report would be noise that
// buries the one line that matters.
export function agreedColumnsLeftOut(
  kind: ReportKind,
  headers: string[],
  fields: ReportField[]
): string[] {
  const inTheSheet = new Set(headers.map(normalizeHeader));
  const madeIt = new Set(fields.map((f) => normalizeHeader(f.label)));

  return REPORT_COLUMNS[kind].filter((name) => {
    const key = normalizeHeader(name);
    return inTheSheet.has(key) && !madeIt.has(key);
  });
}

export interface ReportSection {
  // e.g. "Weekly — July, Week 2", "Daily — 2026-07-08" or "SKU TR04-B" —
  // lets the reviewing human tell which tab/period/SKU each block came from.
  source: string;
  fields: ReportField[];
  // Agreed columns this client's sheet has but that are blank or errored for
  // this period, so they are not in the report. Shown on the Reports screen
  // before anything is sent — see agreedColumnsLeftOut. Absent on the older
  // Client Details preview, which shows the sheet as-is rather than a report.
  leftOut?: string[];
}

// Why a report came back with nothing in it.
//
// The Reports screen used to say the same thing whichever of these it was —
// "this client's sheet isn't filled in yet" — which is a guess presented as a
// fact, and it is wrong in the two cases that actually need doing something
// about. A sheet linked to the wrong file (a master, whose tabs are named
// after clients rather than reports) has no Daily tab at all, and reported
// itself as an empty sheet: whoever was looking went off to fill in numbers
// that were already there, in a different file.
//
//   no_tab             — nothing in this sheet is named like this report's
//                        table. Usually the wrong sheet is linked.
//   no_period_rows     — the table is there, but has no row for the period
//                        asked about. This is the one that really does mean
//                        "not filled in yet".
//   no_agreed_columns  — the row is there, but every agreed column in it was
//                        blank or held a spreadsheet error (#DIV/0! and the
//                        like). Same cause as the missing Acos columns.
export type EmptyReason = "no_tab" | "no_period_rows" | "no_agreed_columns";

export interface WeeklyReportPreview {
  week: number;
  month: string;
  sections: ReportSection[];
  // Only set when `sections` is empty — what to tell the person looking.
  emptyReason?: EmptyReason;
  // The sheet's real tab names, sent only with `no_tab`. Naming what IS in the
  // file is what makes "the wrong sheet is linked" obvious from the screen,
  // rather than something to be worked out by opening it.
  tabsInSheet?: string[];
  // The day the daily figures are actually for, worded as the sheet writes it
  // ("9 August"). Only set on a daily report, and only when a day with figures
  // was found — which is not always the day asked for, since the sheets are
  // filled in a day or two behind. Everything that shows a daily report to a
  // client heads it with this rather than with today's date: the numbers must
  // never be presented as a different day's than the one they came from.
  dailyDate?: string;
}

function withPercentSuffix(fields: ReportField[]): ReportField[] {
  return fields.map((f) => ({ ...f, value: ensurePercentSuffix(f.label, f.value) }));
}

// Resolves which tab this report should read from the spreadsheet's real tab
// list, then reads it. `tab` is null when the sheet has no tab for this report
// at all — a normal state (not every client's sheet carries every table), but
// one worth telling apart from an empty one, so the tab names come back too.
async function readTabForKind(
  spreadsheetId: string,
  kind: ReportKind
): Promise<{ tab: SheetTab | null; tabNames: string[] }> {
  const tabNames = await listTabNames(spreadsheetId);
  const name = pickTab(kind, tabNames);
  return { tab: name ? await readTab(spreadsheetId, name) : null, tabNames };
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
  let dailyDate: string | undefined;

  const { tab, tabNames } = await readTabForKind(spreadsheetId, kind);
  if (!tab) return { week, month, sections, emptyReason: "no_tab", tabsInSheet: tabNames };

  // Set only where a section wasn't produced — see EmptyReason. "The row was
  // found but everything in it was blank" and "there is no such row" look
  // identical on screen otherwise, and they need opposite things done.
  let emptyReason: EmptyReason | undefined;

  // Every section carries what it had to leave out, worked out against this
  // sheet's own headers — see agreedColumnsLeftOut.
  const leftOutOf = (fields: ReportField[]) => agreedColumnsLeftOut(kind, tab.headers, fields);

  if (kind === "daily") {
    const latest = findDailyRowForDate(tab, referenceDate);
    const fields = latest ? onlyAgreedColumns(kind, latest.fields) : [];
    if (latest && fields.length > 0) {
      dailyDate = latest.date;
      sections.push({
        source: `Daily — ${latest.date}`,
        fields: withPercentSuffix(fields),
        leftOut: leftOutOf(fields),
      });
    } else {
      emptyReason = latest ? "no_agreed_columns" : "no_period_rows";
    }
  } else if (kind === "monthly") {
    const found = findMonthlyRowFields(tab, month);
    const fields = found ? onlyAgreedColumns(kind, found) : [];
    if (fields.length > 0) {
      sections.push({
        source: `Monthly — ${month}`,
        fields: withPercentSuffix(fields),
        leftOut: leftOutOf(fields),
      });
    } else {
      emptyReason = found ? "no_agreed_columns" : "no_period_rows";
    }
  } else if (kind === "weekly_sales") {
    const found = findWeeklyRowFields(tab, month, week);
    const fields = found ? onlyAgreedColumns(kind, found) : [];
    if (fields.length > 0) {
      sections.push({
        source: `Weekly — ${month}, Week ${week}`,
        fields: withPercentSuffix(fields),
        leftOut: leftOutOf(fields),
      });
    } else {
      emptyReason = found ? "no_agreed_columns" : "no_period_rows";
    }
  } else {
    const skuRows = findSkuRows(tab, month, week);
    for (const row of skuRows) {
      const fields = onlyAgreedColumns(kind, row.fields);
      if (fields.length > 0) {
        sections.push({ source: row.sku, fields: withPercentSuffix(fields), leftOut: leftOutOf(fields) });
      }
    }
    // SKU rows found but none survived the agreed-column whitelist is a
    // different problem from finding no SKU rows at all.
    if (sections.length === 0) {
      emptyReason = skuRows.length > 0 ? "no_agreed_columns" : "no_period_rows";
    }
  }

  return { week, month, sections, dailyDate, emptyReason };
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
