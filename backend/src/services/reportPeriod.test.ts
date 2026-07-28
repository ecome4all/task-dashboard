import { describe, it, expect } from "vitest";
import { currentWeekNumber, currentMonthName, findWeeklyRowFields, findDailyRowsInWeek } from "./reportPeriod";

describe("currentWeekNumber", () => {
  it("days 1-7 are week 1", () => {
    expect(currentWeekNumber(new Date(2026, 6, 1))).toBe(1);
    expect(currentWeekNumber(new Date(2026, 6, 7))).toBe(1);
  });

  it("days 8-14 are week 2", () => {
    expect(currentWeekNumber(new Date(2026, 6, 8))).toBe(2);
    expect(currentWeekNumber(new Date(2026, 6, 14))).toBe(2);
  });

  it("days 15-21 are week 3", () => {
    expect(currentWeekNumber(new Date(2026, 6, 15))).toBe(3);
    expect(currentWeekNumber(new Date(2026, 6, 21))).toBe(3);
  });

  it("day 22 through month-end is week 4, however long the month is", () => {
    expect(currentWeekNumber(new Date(2026, 6, 22))).toBe(4);
    expect(currentWeekNumber(new Date(2026, 6, 31))).toBe(4);
    expect(currentWeekNumber(new Date(2026, 1, 28))).toBe(4); // February, non-leap
  });
});

describe("currentMonthName", () => {
  it("returns the full month name", () => {
    expect(currentMonthName(new Date(2026, 0, 15))).toBe("January");
    expect(currentMonthName(new Date(2026, 11, 15))).toBe("December");
  });
});

describe("findWeeklyRowFields", () => {
  const tab = {
    headers: ["Month", "Week no.", "Spend", "Sales", "Acos", "T.Sales", "Ads Sales %", "Organic Sales %"],
    rows: [
      ["July", "1", "12500", "98000", "12.76%", "145000", "67.59%", "32.41%"],
      ["July", "2", "8000", "60000", "13.33%", "90000", "66.67%", "33.33%"],
      ["August", "1", "5000", "40000", "12.50%", "70000", "57.14%", "42.86%"],
    ],
  };

  it("finds the row matching both month and week number", () => {
    const fields = findWeeklyRowFields(tab, "July", 2);
    expect(fields).toEqual([
      { label: "Spend", value: "8000" },
      { label: "Sales", value: "60000" },
      { label: "Acos", value: "13.33%" },
      { label: "T.Sales", value: "90000" },
      { label: "Ads Sales %", value: "66.67%" },
      { label: "Organic Sales %", value: "33.33%" },
    ]);
  });

  it("distinguishes the same week number across different months", () => {
    const julyWeek1 = findWeeklyRowFields(tab, "July", 1);
    const augustWeek1 = findWeeklyRowFields(tab, "August", 1);
    expect(julyWeek1?.find((f) => f.label === "Spend")?.value).toBe("12500");
    expect(augustWeek1?.find((f) => f.label === "Spend")?.value).toBe("5000");
  });

  it("matches month case-insensitively and abbreviated", () => {
    expect(findWeeklyRowFields(tab, "JULY", 1)).not.toBeNull();
    expect(findWeeklyRowFields({ ...tab, rows: [["Jul", "1", "1", "1", "1", "1", "1", "1"]] }, "July", 1)).not.toBeNull();
  });

  it("returns null when no row matches", () => {
    expect(findWeeklyRowFields(tab, "September", 1)).toBeNull();
  });

  it("returns null when the tab has no recognizable Week column", () => {
    expect(findWeeklyRowFields({ headers: ["Foo", "Bar"], rows: [["1", "2"]] }, "July", 1)).toBeNull();
  });
});

describe("findDailyRowsInWeek", () => {
  const tab = {
    headers: ["Date", "Spend", "Active Listing"],
    rows: [
      ["2026-07-01", "1000", "50"],
      ["2026-07-05", "1200", "51"],
      ["2026-07-08", "900", "49"], // week 2, out of range for week 1
      ["2026-06-05", "500", "48"], // same day-of-month, different month
    ],
  };

  it("returns only rows whose date falls in the current week and month", () => {
    const rows = findDailyRowsInWeek(tab, new Date(2026, 6, 3)); // July 3 -> week 1
    expect(rows.map((r) => r.date)).toEqual(["2026-07-01", "2026-07-05"]);
  });

  it("each returned row excludes the Date column itself from its fields", () => {
    const rows = findDailyRowsInWeek(tab, new Date(2026, 6, 3));
    expect(rows[0].fields).toEqual([
      { label: "Spend", value: "1000" },
      { label: "Active Listing", value: "50" },
    ]);
  });

  it("week 4 covers through the actual end of the month", () => {
    const longMonth = {
      headers: ["Date", "Spend"],
      rows: [["2026-07-31", "1"]],
    };
    expect(findDailyRowsInWeek(longMonth, new Date(2026, 6, 25))).toHaveLength(1);
  });
});
