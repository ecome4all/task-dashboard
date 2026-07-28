import { extractSpreadsheetId, readTab } from "./googleSheets";
import { currentWeekNumber, currentMonthName, findWeeklyRowFields, findDailyRowsInWeek, ReportField } from "./reportPeriod";
import { ensurePercentSuffix } from "./reportFormatting";

// Each entry is a tab to read and how to match "the current period" within
// it. Adding a 3rd/4th tab later (once known) is one more entry here, not a
// rewrite of the read/match pipeline.
const REPORT_TABS: { name: string; kind: "weekly" | "daily" }[] = [
  { name: "Weekly", kind: "weekly" },
  { name: "Daily", kind: "daily" },
];

export interface ReportSection {
  // e.g. "Weekly — July, Week 2" or "Daily — 2026-07-08" -- lets the
  // reviewing human tell which tab/period each block of fields came from.
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

// Pulls every configured tab for a client's sheet and returns whatever
// fields match the current week/month, grouped by tab and (for the daily
// tab) by date. A tab that doesn't exist on this particular sheet, or has
// no row for the current period yet, is simply omitted rather than causing
// the whole preview to fail -- not every client's sheet has every tab.
export async function buildWeeklyReportPreview(sheetUrl: string, referenceDate: Date): Promise<WeeklyReportPreview> {
  const spreadsheetId = extractSpreadsheetId(sheetUrl);
  if (!spreadsheetId) {
    throw new Error("Couldn't find a spreadsheet id in the saved sheet link.");
  }

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
