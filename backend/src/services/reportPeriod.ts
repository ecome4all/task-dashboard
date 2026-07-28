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
