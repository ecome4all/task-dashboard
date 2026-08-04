import { describe, it, expect } from "vitest";
import { pickTab } from "./weeklyReportPreview";

// The three naming schemes seen across real client sheets. All must work —
// hardcoding any one of them made every report silently return nothing when a
// sheet used a different wording.
const SAMPLE_SHEET = ["Daily Report", "Weekly Sales", "Weekly SKU Sales"];
const GENERATOR = ["Monthly Summary", "Listing Optimisation Tracker", "Weekly Summary", "Daily Tracker", "ASIN Weekly Breakdown"];
const ORIGINAL = ["Weekly", "Daily", "SKU"];

describe("pickTab", () => {
  it("matches the sample client sheet's names", () => {
    expect(pickTab("daily", SAMPLE_SHEET)).toBe("Daily Report");
    expect(pickTab("weekly_sales", SAMPLE_SHEET)).toBe("Weekly Sales");
    expect(pickTab("weekly_sku", SAMPLE_SHEET)).toBe("Weekly SKU Sales");
  });

  it("matches the generator script's names", () => {
    expect(pickTab("daily", GENERATOR)).toBe("Daily Tracker");
    expect(pickTab("weekly_sales", GENERATOR)).toBe("Weekly Summary");
    expect(pickTab("weekly_sku", GENERATOR)).toBe("ASIN Weekly Breakdown");
  });

  it("still matches the original short names", () => {
    expect(pickTab("daily", ORIGINAL)).toBe("Daily");
    expect(pickTab("weekly_sales", ORIGINAL)).toBe("Weekly");
    expect(pickTab("weekly_sku", ORIGINAL)).toBe("SKU");
  });

  // The trap: "Weekly SKU Sales" contains "Weekly", so a naive weekly rule
  // would grab the per-SKU tab and report the wrong numbers.
  it("does not let the weekly rule claim the SKU tab", () => {
    expect(pickTab("weekly_sales", ["Weekly SKU Sales"])).toBeNull();
    expect(pickTab("weekly_sales", ["Weekly SKU Sales", "Weekly Sales"])).toBe("Weekly Sales");
  });

  it("does not let the daily rule claim a daily SKU tab", () => {
    expect(pickTab("daily", ["Daily ASIN Breakdown"])).toBeNull();
  });

  it("ignores tabs no report reads", () => {
    const tabs = ["Monthly Summary", "Listing Optimisation Tracker", "Notes"];
    expect(pickTab("daily", tabs)).toBeNull();
    expect(pickTab("weekly_sales", tabs)).toBeNull();
    expect(pickTab("weekly_sku", tabs)).toBeNull();
  });

  it("is case-insensitive", () => {
    expect(pickTab("daily", ["DAILY TRACKER"])).toBe("DAILY TRACKER");
    expect(pickTab("weekly_sku", ["weekly sku sales"])).toBe("weekly sku sales");
  });

  it("returns null for an empty spreadsheet", () => {
    expect(pickTab("daily", [])).toBeNull();
  });

  // "Weekend notes" must not read as the weekly table.
  it("matches whole words only", () => {
    expect(pickTab("weekly_sales", ["Weekend notes"])).toBeNull();
    expect(pickTab("daily", ["Dailyish"])).toBeNull();
  });
});

describe("pickTab — monthly", () => {
  it("finds the monthly tab once a client sheet carries one", () => {
    expect(pickTab("monthly", ["Daily Report", "Weekly Sales", "Weekly SKU Sales", "Monthly Summary"]))
      .toBe("Monthly Summary");
  });

  // "Monthly Summary" contains neither "week" nor "daily", so it must not be
  // claimed by either of those rules.
  it("does not confuse monthly with the weekly or daily tabs", () => {
    const tabs = ["Daily Report", "Weekly Sales", "Monthly Summary"];
    expect(pickTab("weekly_sales", tabs)).toBe("Weekly Sales");
    expect(pickTab("daily", tabs)).toBe("Daily Report");
  });

  it("returns null when the sheet has no monthly tab", () => {
    expect(pickTab("monthly", ["Daily Report", "Weekly Sales"])).toBeNull();
  });
});
