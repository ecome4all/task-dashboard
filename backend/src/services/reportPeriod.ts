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

// Spreadsheet error cells (#DIV/0!, #N/A, #REF!, #VALUE!) reach us as text.
// Sending "#DIV/0!" to a client is worse than saying nothing, and the percent
// suffix rule turns it into the even odder "#DIV/0!%", so these are dropped
// from a report entirely rather than passed through.
function isErrorCell(value: string): boolean {
  return value.trim().startsWith("#");
}

// Whether a cell is actually a number: "7306.36", "4,234", "37.66%" yes;
// "Mini Case - 1" or "forensic files" no. Used to tell a row that genuinely
// has this period's figures from one that only carries labels or leftovers.
function looksNumeric(value: string): boolean {
  const cleaned = value.trim().replace(/[,\s%₹$]/g, "");
  return cleaned !== "" && !Number.isNaN(Number(cleaned));
}

// A zero is the sheet saying nothing happened on that line. "Spend: 0,
// Order: 0, Sales: 0" tells a client nothing, so a zero is never ticked to be
// sent — but it is still read out of the sheet and still shown on the Reports
// screen, unticked, so staff can see it is a nought rather than wondering
// whether the line went missing. Where there is nobody to do the ticking, the
// automatic send drops them itself (composeReportMessage).
//
// Blank is not zero — that is dropped in usableFields below. This is only a
// cell that really holds a nought, in any of the ways these sheets write one:
// "0", "0.00", "0%", "0.00%", "₹0".
export function isZeroValue(value: string): boolean {
  const cleaned = value.trim().replace(/[,\s%₹$]/g, "");
  if (cleaned === "") return false;
  const asNumber = Number(cleaned);
  return !Number.isNaN(asNumber) && asNumber === 0;
}

function usableFields(headers: string[], row: string[], skipIndexes: number[]): ReportField[] {
  return headers
    .map((label, i) => ({ label, value: row[i] ?? "" }))
    .filter((f, i) => !skipIndexes.includes(i) && f.value.trim() !== "" && !isErrorCell(f.value));
}

// The Week column is written "WEEK 1" in the real sheets, not "1", so the
// number is pulled out of whatever wording surrounds it.
function weekNumberIn(cellValue: string): number | null {
  const match = cellValue.match(/\d+/);
  return match ? Number(match[0]) : null;
}

// Dates are written "1 August" — a day and a month name, with no year. That
// is not something Date can parse on its own, so the reference year is
// supplied. Anything already parseable (2026-08-01, 01/08/2026) still works.
function parseSheetDate(cellValue: string, referenceDate: Date): Date | null {
  const raw = cellValue.trim();
  if (!raw) return null;

  const direct = new Date(raw);
  if (!Number.isNaN(direct.getTime()) && /\d{4}/.test(raw)) return direct;

  const withYear = new Date(`${raw} ${referenceDate.getFullYear()}`);
  if (!Number.isNaN(withYear.getTime())) return withYear;

  return Number.isNaN(direct.getTime()) ? null : direct;
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
    const weekMatches = weekNumberIn(r[weekIdx] ?? "") === weekNumber;
    const monthMatches = monthIdx === -1 || isSameMonth(r[monthIdx] ?? "", monthName);
    return weekMatches && monthMatches;
  });
  if (!row) return null;

  return usableFields(tab.headers, row, [weekIdx, monthIdx]);
}

// Which calendar year each row of a month table belongs to.
//
// The Month column carries no year anywhere in it. The real sheets write
// "DECEMBER", "Jan", "FEBRUARY", "Aug" — one row per month, running straight
// down the table and simply carrying on past December into the next year:
//
//   DECEMBER JANUARY ... Nov | DECEMBER Jan ... July Aug
//   \_______ one year ______/ \_______ the next ______/
//
// So a sheet that has been running for more than twelve months has two rows
// headed "Aug", with nothing in either of them to say which is which. Taking
// the first match sent clients last year's August — reported by Ecom4all,
// and the reason this exists.
//
// The year is worked out from the order instead. The table is chronological,
// so each time the month goes backwards a new year has started; that gives
// every row a year relative to the others. The anchor that turns those into
// calendar years is the last row that actually has figures in it — the most
// recent month the sheet has been filled in for, which is at or before the
// month being asked about.
//
// Rows with no month in them (blank spacers, a stray total) get null and are
// skipped, without breaking the run either side of them.
function monthIndexIn(cellValue: string): number | null {
  const cell = cellValue.trim().toLowerCase();
  if (cell === "") return null;
  // The same first-three-letters rule isSameMonth uses, so the two never
  // disagree about what a cell says.
  const found = MONTH_NAMES.findIndex((m) => cell.startsWith(m.toLowerCase().slice(0, 3)));
  return found === -1 ? null : found;
}

function assignRowYears(tab: SheetTab, monthIdx: number, today: Date): (number | null)[] {
  // Year relative to the first block: 0, then 1 after the first wrap past
  // December, and so on.
  const offsets: (number | null)[] = [];
  let offset = 0;
  let previous: number | null = null;

  for (const row of tab.rows) {
    const month = monthIndexIn(row[monthIdx] ?? "");
    if (month === null) {
      offsets.push(null);
      continue;
    }
    if (previous !== null && month < previous) offset++;
    previous = month;
    offsets.push(offset);
  }

  // The anchor: the last row with a month AND figures beside it. A blank row
  // for a month not filled in yet must not anchor anything — the sheets carry
  // rows for months ahead of themselves, and anchoring on one would push every
  // year in the table out by one.
  let anchorMonth: number | null = null;
  let anchorOffset = 0;
  for (let i = 0; i < tab.rows.length; i++) {
    if (offsets[i] === null) continue;
    const row = tab.rows[i];
    if (!row.some((cell, c) => c !== monthIdx && looksNumeric(cell ?? ""))) continue;
    anchorMonth = monthIndexIn(row[monthIdx] ?? "");
    anchorOffset = offsets[i]!;
  }
  if (anchorMonth === null) return tab.rows.map(() => null);

  // The anchor row is the most recent month anyone has filled in, so it is the
  // most recent occurrence of that month at or before today — this year,
  // unless its month is still ahead of the current one, which puts it in the
  // year before.
  //
  // Deliberately today rather than the month being asked about. Those are the
  // same thing for a report sent on the day, but not when an earlier month is
  // being looked at or re-sent: pinning the table to the year asked for would
  // make every year in it the year asked for, and August 2025 would return
  // August 2026's figures — the reported fault, mirrored.
  const anchorYear = today.getFullYear() - (anchorMonth > today.getMonth() ? 1 : 0);

  return offsets.map((o) => (o === null ? null : anchorYear - (anchorOffset - o)));
}

// Monthly tab: one row per month, matched on the Month column alone. Kept
// separate from the weekly finder because that one requires a Week column,
// which this table does not have.
//
// `year` is the year the report was asked for — the Reports screen picks a
// month with <input type="month">, so it always sends one. `today` is what
// pins the sheet's rows to the calendar, and is separate because an earlier
// month can be looked at or re-sent long after it ended. Both are only
// consulted when the sheet has more than one row for the month, which is the
// only case where the old first-match-wins rule could pick the wrong one; a
// sheet with a single year of rows behaves exactly as it always did.
//
// When the sheet has two rows for the month and neither works out to the year
// asked for, nothing is returned rather than a guess. The screen then says the
// sheet has no row for that period, which is true — and far better than
// sending a client a year-old figure under this year's heading, which is the
// fault this replaced.
//
// findWeeklyRowFields has the same shape of risk, but only on a Weekly tab
// that carries a Month column and more than a year of rows. No sheet seen has
// one — the real Weekly tabs hold the current month's four weeks and no Month
// column at all — so it is deliberately left alone rather than changed blind.
export function findMonthlyRowFields(
  tab: SheetTab,
  monthName: string,
  year: number,
  today: Date = new Date()
): ReportField[] | null {
  const monthIdx = findHeaderIndex(tab.headers, /month/i);
  if (monthIdx === -1) return null;

  const matches = tab.rows.filter((r) => isSameMonth(r[monthIdx] ?? "", monthName));
  if (matches.length === 0) return null;

  let row: string[] | undefined;
  if (matches.length === 1) {
    row = matches[0];
  } else {
    const years = assignRowYears(tab, monthIdx, today);
    row = tab.rows.find((r, i) => years[i] === year && isSameMonth(r[monthIdx] ?? "", monthName));
  }
  if (!row) return null;

  const fields = usableFields(tab.headers, row, [monthIdx]);
  // Same rule as the daily tab: a month with no figures yet is not a report.
  return fields.some((f) => looksNumeric(f.value)) ? fields : null;
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
  const skuHeader = (tab.headers[skuIdx] ?? "").trim().toLowerCase();

  // The real sheets stack one block per week down a single tab, each block
  // starting with its own repeated header row ("ASIN | Name | Spend | ..."),
  // and carry no Week column to tell the blocks apart. Reading the whole tab
  // therefore reported every week at once, with the header rows themselves
  // appearing as products called "ASIN".
  //
  // So: split on the repeated headers, and report only the last block — the
  // most recent week, which is what a weekly report is about.
  const blocks: string[][][] = [[]];
  for (const row of tab.rows) {
    const cell = (row[skuIdx] ?? "").trim();
    if (cell.toLowerCase() === skuHeader) {
      blocks.push([]); // a repeated header row starts the next week's block
      continue;
    }
    blocks[blocks.length - 1].push(row);
  }
  // The final block is often next week's, pre-filled with product names but
  // no figures yet. Take the last block that actually has numbers in it.
  const latest =
    blocks
      .filter((b) =>
        b.some((r) => r.some((cell, i) => i !== skuIdx && looksNumeric(cell ?? "")))
      )
      .pop() ?? [];

  return latest
    .filter((row) => {
      // Only applied when the columns exist — most SKU tabs have neither.
      const weekMatches = weekIdx === -1 || weekNumberIn(row[weekIdx] ?? "") === weekNumber;
      const monthMatches = monthIdx === -1 || isSameMonth(row[monthIdx] ?? "", monthName);
      return weekMatches && monthMatches;
    })
    .map((row) => ({
      sku: (row[skuIdx] ?? "").trim(),
      fields: usableFields(tab.headers, row, [skuIdx, weekIdx, monthIdx]),
    }))
    .filter((r) => r.sku !== "" && r.fields.length > 0);
}

// How far back the daily report will look for the last day someone filled in.
//
// It used to read today's row and only today's row, which meant it almost
// never found anything: the sheets are filled a day or two behind, because
// Amazon's own figures arrive late, so at the hour a report is sent today's
// row is still blank. Every client came back "no data found" and no daily
// report could go out at all.
//
// A week covers a weekend, a holiday, and someone being off. Past that the
// numbers are too old to send as an update, and saying nothing is right.
export const DAILY_LOOK_BACK_DAYS = 7;

// The most recent day in the daily tab that actually has figures, at or
// before the reference date — the one day the Daily Report is about. Compare
// findDailyRowsInWeek below, which surfaces the whole week for someone
// reviewing before a weekly send.
//
// Never a row dated later than the reference date. Blank rows exist for every
// remaining day of the month, and one of those going out as "today" would
// have a client reading an empty day as their account's figures.
//
// Known edge: dates written without a year ("31 December") are read as the
// reference date's year, so in the first days of January this does not reach
// back into the previous month. Rare, and it errs towards sending nothing.
export function findDailyRowForDate(
  tab: SheetTab,
  referenceDate: Date,
  lookBackDays: number = DAILY_LOOK_BACK_DAYS
): { date: string; fields: ReportField[] } | null {
  const dateIdx = findHeaderIndex(tab.headers, /date/i);
  if (dateIdx === -1) return null;

  const year = referenceDate.getFullYear();
  const month = referenceDate.getMonth();
  const day = referenceDate.getDate();
  const latestAllowed = new Date(year, month, day, 23, 59, 59);
  const earliestAllowed = new Date(year, month, day - lookBackDays);

  let best: { date: string; fields: ReportField[]; on: Date } | null = null;

  for (const row of tab.rows) {
    const parsed = parseSheetDate(row[dateIdx] ?? "", referenceDate);
    if (!parsed || Number.isNaN(parsed.getTime())) continue;
    if (parsed > latestAllowed || parsed < earliestAllowed) continue;

    const fields = usableFields(tab.headers, row, [dateIdx]);
    // A row can carry a stray text column with no figures beside it (these
    // sheets keep a keyword column alongside the metrics), which once went to
    // a client on its own as a whole day's report. No figures, no day — and
    // the search carries on to the day before.
    if (!fields.some((f) => looksNumeric(f.value))) continue;

    if (!best || parsed > best.on) best = { date: (row[dateIdx] ?? "").trim(), fields, on: parsed };
  }

  return best ? { date: best.date, fields: best.fields } : null;
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
