import { describe, it, expect } from "vitest";
import { onlyAgreedColumns } from "./weeklyReportPreview";

// The headers below are the real ones, read off the generated client sheets.
// The Monthly Summary and the Daily table head the same figures differently,
// and matching only the daily wording is what sent a monthly report with three
// lines in it.
const MONTHLY_HEADERS = [
  { label: "Spend", value: "12,480" },
  { label: "Ad Orders", value: "37" },
  { label: "Ad Sales", value: "48,210" },
  { label: "ACOS", value: "49.66%" },
  { label: "T.Orders", value: "96" },
  { label: "T.Sales", value: "114,096" },
  { label: "T.ACOS", value: "8.26%" },
  { label: "Ad Sales %", value: "42.25%" },
  { label: "Organic Sales %", value: "57.75%" },
  { label: "Target Achived", value: "YES" },
  { label: "Keyword", value: "forensic files" },
];

describe("onlyAgreedColumns — monthly", () => {
  const kept = onlyAgreedColumns("monthly", MONTHLY_HEADERS).map((f) => f.label);

  // The bug: only these three are spelled the same in both tables, so these
  // three were the entire monthly report.
  it("keeps the spend and sales columns, not just the three that matched by luck", () => {
    expect(kept).toContain("Spend");
    expect(kept).toContain("Ad Orders");
    expect(kept).toContain("Ad Sales");
    expect(kept).toContain("T.Orders");
    expect(kept).toContain("Ad Sales %");
  });

  it("still keeps the ones that always worked", () => {
    expect(kept).toContain("ACOS");
    expect(kept).toContain("T.Sales");
    expect(kept).toContain("T.ACOS");
    expect(kept).toContain("Organic Sales %");
  });

  // These sit in the same table on the master and are internal. A client must
  // never see them, which is the whole reason the list is a whitelist.
  it("never lets an internal column through", () => {
    expect(kept).not.toContain("Target Achived");
    expect(kept).not.toContain("Keyword");
  });

  it("shows the client their own sheet's wording, not ours", () => {
    const adSales = onlyAgreedColumns("monthly", MONTHLY_HEADERS).find((f) => f.value === "48,210");
    expect(adSales?.label).toBe("Ad Sales");
  });

  // A column nobody has seen before stays out, rather than being guessed at.
  it("drops a column that isn't one of the agreed ones", () => {
    expect(onlyAgreedColumns("monthly", [{ label: "Buy Box Share", value: "88%" }])).toHaveLength(0);
  });
});

describe("onlyAgreedColumns — the other reports", () => {
  it("keeps the daily table's own wording working", () => {
    const kept = onlyAgreedColumns("daily", [
      { label: "Spend", value: "402" },
      { label: "Order", value: "3" },
      { label: "Sales", value: "2,045" },
      { label: "T.Order", value: "9" },
      { label: "Ads Sales %", value: "35.05%" },
      { label: "Active Listing", value: "221" },
    ]).map((f) => f.label);
    expect(kept).toHaveLength(6);
  });

  // Weekly Sales has no orders column at all, so one appearing there is not
  // something to start forwarding.
  it("doesn't add an orders column to the weekly report", () => {
    expect(onlyAgreedColumns("weekly_sales", [{ label: "Ad Orders", value: "37" }])).toHaveLength(0);
  });
});
