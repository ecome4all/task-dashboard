import { SheetTab } from "./googleSheets";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// Week 1-3 are always exactly 7 days; Week 4 absorbs whatever's left in the
// month (7-10 days depending on length) -- the client's own convention, not
// a calendar week (Mon-Sun).
export function currentWeekNumber(date: Date): 1 | 2 | 3 | 4 {
  const day = date.getDate();
  if (day <= 7) return 1;
  if (day <= 14) return 2;
  if (day <= 21) return 3;
  return 4;
}

export function currentMonthName(date: Date): string {
  return MONTH_NAMES[date.getMonth()];
}

// Tolerant of case and full-vs-abbreviated month names ("July", "JULY",
// "Jul", "jul" all match) -- the exact convention the real sheets use for
// this column wasn't confirmed, so this matches on the first three letters
// rather than requiring an exact string.
function isSameMonth(cellValue: string, monthName: string): boolean {
  const cell = cellValue.trim().toLowerCase();
  return cell.startsWith(monthName.toLowerCase().slice(0, 3));
}

function findHeaderIndex(headers: string[], pattern: RegExp): number {
  return headers.findIndex((h) => pattern.test(h));
}

export interface ReportField {
  label: string;
  value: string;
}

// Tab 1 (weekly): one row per (Month, Week no.). If the tab has no Month
// column at all, falls back to matching on Week no. alone -- the caller
// should treat a tab shaped that way as a known limitation, not a crash.
export function findWeeklyRowFields(tab: SheetTab, monthName: string, weekNumber: number): ReportField[] | null {
  const weekIdx = findHeaderIndex(tab.headers, /week/i);
  if (weekIdx === -1) return null;
  const monthIdx = findHeaderIndex(tab.headers, /month/i);

  const row = tab.rows.find((r) => {
    const weekMatches = r[weekIdx]?.trim() === String(weekNumber);
    const monthMatches = monthIdx === -1 || isSameMonth(r[monthIdx] ?? "", monthName);
    return weekMatches && monthMatches;
  });
  if (!row) return null;

  return tab.headers
    .map((label, i) => ({ label, value: row[i] ?? "" }))
    .filter((f, i) => i !== weekIdx && i !== monthIdx && f.value !== "");
}

// SKU tab: one row per SKU rather than one row per period, so this returns
// many groups where the weekly tab returns one. Month/Week columns are
// optional — a sheet that keeps only the current week's SKUs has no need
// for them, and requiring them would mean the tab silently reads as empty.
// When they are present, rows are narrowed to the current period the same
// way findWeeklyRowFields does it.
//
// The SKU column is matched on /sku|asin|item|product/i so the tab doesn't
// have to be titled one exact way — the existing sheets already vary in
// how they name columns, which is why every other matcher here is a regex
// too.
export function findSkuRows(
  tab: SheetTab,
  monthName: string,
  weekNumber: number
): { sku: string; fields: ReportField[] }[] {
  const skuIdx = findHeaderIndex(tab.headers, /sku|asin|item|product/i);
  if (skuIdx === -1) return [];

  const weekIdx = findHeaderIndex(tab.headers, /week/i);
  const monthIdx = findHeaderIndex(tab.headers, /month/i);

  return tab.rows
    .filter((row) => {
      const weekMatches = weekIdx === -1 || row[weekIdx]?.trim() === String(weekNumber);
      const monthMatches = monthIdx === -1 || isSameMonth(row[monthIdx] ?? "", monthName);
      return weekMatches && monthMatches;
    })
    .map((row) => ({
      sku: row[skuIdx]?.trim() ?? "",
      fields: tab.headers
        .map((label, i) => ({ label, value: row[i] ?? "" }))
        .filter((f, i) => i !== skuIdx && i !== weekIdx && i !== monthIdx && f.value !== ""),
    }))
    .filter((r) => r.sku !== "" && r.fields.length > 0);
}

// Just today's row from the daily tab — what the Daily Report sends, as
// opposed to findDailyRowsInWeek below, which surfaces the whole week for
// someone reviewing before a weekly send.
export function findDailyRowForDate(tab: SheetTab, referenceDate: Date): { date: string; fields: ReportField[] } | null {
  const dateIdx = findHeaderIndex(tab.headers, /date/i);
  if (dateIdx === -1) return null;

  const match = tab.rows.find((row) => {
    const raw = row[dateIdx]?.trim();
    if (!raw) return false;
    const parsed = new Date(raw);
    return (
      !Number.isNaN(parsed.getTime()) &&
      parsed.getFullYear() === referenceDate.getFullYear() &&
      parsed.getMonth() === referenceDate.getMonth() &&
      parsed.getDate() === referenceDate.getDate()
    );
  });
  if (!match) return null;

  return {
    date: match[dateIdx]!.trim(),
    fields: tab.headers
      .map((label, i) => ({ label, value: match[i] ?? "" }))
      .filter((f, i) => i !== dateIdx && f.value !== ""),
  };
}

// Tab 2 (daily): every row whose Date falls within the current week's date
// range gets surfaced (not just one) -- the reviewing human picks which
// date(s) matter, per the "the client will handle it" design.
export function findDailyRowsInWeek(tab: SheetTab, referenceDate: Date): { date: string; fields: ReportField[] }[] {
  const dateIdx = findHeaderIndex(tab.headers, /date/i);
  if (dateIdx === -1) return [];

  const week = currentWeekNumber(referenceDate);
  const year = referenceDate.getFullYear();
  const month = referenceDate.getMonth();
  const rangeStart = week === 4 ? 22 : (week - 1) * 7 + 1;
  const rangeEnd = week === 4 ? new Date(year, month + 1, 0).getDate() : week * 7;

  return tab.rows
    .map((row) => {
      const raw = row[dateIdx]?.trim();
      const parsed = raw ? new Date(raw) : null;
      const inRange =
        parsed && !Number.isNaN(parsed.getTime()) && parsed.getFullYear() === year && parsed.getMonth() === month
          ? parsed.getDate() >= rangeStart && parsed.getDate() <= rangeEnd
          : false;
      return { raw, row, inRange };
    })
    .filter((r) => r.inRange)
    .map(({ raw, row }) => ({
      date: raw!,
      fields: tab.headers
        .map((label, i) => ({ label, value: row[i] ?? "" }))
        .filter((f, i) => i !== dateIdx && f.value !== ""),
    }));
}
