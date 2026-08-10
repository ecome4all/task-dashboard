import { describe, it, expect } from "vitest";
import { findDailyRowForDate, findWeeklyRowFields, findSkuRows, findMonthlyRowFields } from "./reportPeriod";
import { SheetTab } from "./googleSheets";

// These fixtures are the actual shapes read out of a real generated client
// sheet ("Forensic Files — Amazon Tracker"), not invented ones. Every case
// below is something that produced a wrong or empty report before.

describe("Daily Report tab", () => {
  // The Date column reads "1 August" — a day and a month name with no year,
  // which Date cannot parse on its own.
  const tab: SheetTab = {
    headers: ["Date", "Spend", "Order", "Sales", "Acos", "T.Acos"],
    rows: [
      ["1 August", "1,971", "6", "14,510", "13.58%", "9.20%"],
      ["2 August", "2,263", "7", "7,181", "31.51%", "#DIV/0!"],
      ["3 August", "", "", "", "", ""],
    ],
  };

  it("matches a date written without a year", () => {
    const row = findDailyRowForDate(tab, new Date(2026, 7, 1)); // 1 Aug 2026
    expect(row?.date).toBe("1 August");
    expect(row?.fields.find((f) => f.label === "Sales")?.value).toBe("14,510");
  });

  it("picks the right day, not just the first row", () => {
    expect(findDailyRowForDate(tab, new Date(2026, 7, 2))?.date).toBe("2 August");
  });

  // A blank row exists for every future day of the month. Asked for such a
  // day, the report falls back to the last day that was filled in rather than
  // reporting nothing — the sheets run a day or two behind, so reading only
  // the day asked for meant almost every client came back empty.
  it("falls back to the last day with numbers", () => {
    const row = findDailyRowForDate(tab, new Date(2026, 7, 3));
    expect(row?.date).toBe("2 August");
    expect(row?.fields.find((f) => f.label === "Spend")?.value).toBe("2,263");
  });

  // Old numbers are worse than none: past a week they no longer describe the
  // account, and a client reading them as today's would be misled.
  it("does not reach back further than a week", () => {
    expect(findDailyRowForDate(tab, new Date(2026, 7, 20))).toBeNull();
  });

  // Rows exist for the whole month ahead. One of those going out as today's
  // report would show a client an empty day as their account.
  it("never reads a day later than the one asked for", () => {
    expect(findDailyRowForDate(tab, new Date(2026, 7, 1))?.date).toBe("1 August");
  });

  // The real Daily tab carries a keyword column ("crime solving case files")
  // alongside the metrics. On a day not filled in yet, that was the only
  // surviving field, so the client got a "report" containing one stray phrase.
  it("reports nothing for a day that has only text and no figures", () => {
    const withKeyword: SheetTab = {
      headers: ["Date", "Spend", "Sales", "crime solving case files"],
      rows: [["4 August", "", "", "forensic files"]],
    };
    expect(findDailyRowForDate(withKeyword, new Date(2026, 7, 4))).toBeNull();
  });

  // The fallback must not turn that stray text into a report either: it skips
  // such a day and keeps looking, rather than settling for it.
  it("skips past a text-only day to a real one", () => {
    const withKeyword: SheetTab = {
      headers: ["Date", "Spend", "Sales", "crime solving case files"],
      rows: [
        ["3 August", "1,971", "14,510", "forensic files"],
        ["4 August", "", "", "forensic files"],
      ],
    };
    const row = findDailyRowForDate(withKeyword, new Date(2026, 7, 4));
    expect(row?.date).toBe("3 August");
    expect(row?.fields.find((f) => f.label === "Sales")?.value).toBe("14,510");
  });

  // "#DIV/0!" would otherwise be sent to a client, and the percent rule turns
  // it into "#DIV/0!%".
  it("drops spreadsheet error cells", () => {
    const row = findDailyRowForDate(tab, new Date(2026, 7, 2));
    expect(row?.fields.some((f) => f.value.includes("#DIV/0!"))).toBe(false);
  });
});

describe("Weekly Sales tab", () => {
  // The Week column reads "WEEK 1", not "1".
  const tab: SheetTab = {
    headers: ["Week", "Spend", "Sales", "Acos", "T.Sales"],
    rows: [
      ["WEEK 1", "4,234", "21,690", "19.52%", "45,900"],
      ["WEEK 2", "0", "0", "#DIV/0!", "0"],
      ["", "6.05%", "6.20%", "#DIV/0!", ""],
    ],
  };

  it("matches a week written as 'WEEK 1'", () => {
    const fields = findWeeklyRowFields(tab, "August", 1);
    expect(fields?.find((f) => f.label === "Sales")?.value).toBe("21,690");
  });

  it("matches week 2 separately", () => {
    expect(findWeeklyRowFields(tab, "August", 2)?.find((f) => f.label === "Spend")?.value).toBe("0");
  });

  it("drops error cells from the row it returns", () => {
    expect(findWeeklyRowFields(tab, "August", 2)?.some((f) => f.value.includes("#DIV/0!"))).toBe(false);
  });

  it("returns nothing for a week the sheet has no row for", () => {
    expect(findWeeklyRowFields(tab, "August", 4)).toBeNull();
  });
});

describe("Weekly SKU Sales tab", () => {
  // The real tab stacks one block per week, each starting with its own
  // repeated header row, and has no Week column to separate them.
  const tab: SheetTab = {
    headers: ["ASIN", "Name", "Spend", "Order", "Acos"],
    rows: [
      ["B0FTSMLVJB", "Mini Case - 1", "7306.36", "23", "37.66%"],
      ["B0DNJP2ZRS", "Bollywood Premiere", "1462.48", "5", "17.99%"],
      ["ASIN", "Name", "Spend", "Order", "Acos"], // start of the next week
      ["B0FTSMLVJB", "Mini Case - 1", "7779.85", "34", "27.38%"],
      ["B0DNJP2ZRS", "Bollywood Premiere", "385.82", "2", "#DIV/0!"],
    ],
  };

  it("reports only the most recent week's block", () => {
    const rows = findSkuRows(tab, "August", 1);
    expect(rows).toHaveLength(2);
    expect(rows[0].fields.find((f) => f.label === "Spend")?.value).toBe("7779.85");
  });

  // Before this, the repeated header row came back as a product called "ASIN".
  it("never reports a repeated header row as a product", () => {
    expect(findSkuRows(tab, "August", 1).some((r) => r.sku === "ASIN")).toBe(false);
  });

  it("drops error cells", () => {
    const rows = findSkuRows(tab, "August", 1);
    expect(rows.some((r) => r.fields.some((f) => f.value.includes("#DIV/0!")))).toBe(false);
  });

  // The final block is often next week's, pre-filled with product names but
  // no figures. Reporting it gave the client a list of names and no numbers.
  it("skips a trailing block that has names but no figures", () => {
    const withEmptyLast: SheetTab = {
      headers: ["ASIN", "Name", "Spend", "Order"],
      rows: [
        ["B0FTSMLVJB", "Mini Case - 1", "7779.85", "34"],
        ["ASIN", "Name", "Spend", "Order"],
        ["B0FTSMLVJB", "Mini Case - 1", "", ""],
      ],
    };
    const rows = findSkuRows(withEmptyLast, "August", 1);
    expect(rows).toHaveLength(1);
    expect(rows[0].fields.find((f) => f.label === "Spend")?.value).toBe("7779.85");
  });

  it("still works on a tab with a single block and no repeated headers", () => {
    const single: SheetTab = { headers: tab.headers, rows: tab.rows.slice(0, 2) };
    expect(findSkuRows(single, "August", 1)).toHaveLength(2);
  });
});

describe("Monthly Summary tab", () => {
  // Same table as the master's, including the two internal columns.
  const tab: SheetTab = {
    headers: ["Month", "Spend", "Order", "Sales", "Acos", "Target Achieved", "Keyword"],
    rows: [
      ["JULY", "45,028", "146", "205,442", "21.91%", "Yes", "detective case"],
      ["August", "4,234", "13", "21,690", "19.52%", "No", "forensic files"],
      ["September", "", "", "", "", "", ""],
    ],
  };

  it("matches the current month", () => {
    const fields = findMonthlyRowFields(tab, "August");
    expect(fields?.find((f) => f.label === "Sales")?.value).toBe("21,690");
  });

  it("is tolerant of capitalisation", () => {
    expect(findMonthlyRowFields(tab, "July")?.find((f) => f.label === "Spend")?.value).toBe("45,028");
  });

  it("reports nothing for a month with no figures yet", () => {
    expect(findMonthlyRowFields(tab, "September")).toBeNull();
  });

  it("returns nothing for a month the sheet has no row for", () => {
    expect(findMonthlyRowFields(tab, "December")).toBeNull();
  });
});
