import { describe, it, expect } from "vitest";
import { agreedColumnsLeftOut, onlyAgreedColumns } from "./weeklyReportPreview";

// A weekly_sales sheet with the usual columns.
const WEEKLY_HEADERS = [
  "Week", "Spend", "Sales", "Acos", "T.Sales", "T.Acos", "Ads Sales %", "Organic Sales %",
];

const field = (label: string, value = "100") => ({ label, value });

describe("agreedColumnsLeftOut", () => {
  it("finds nothing when every column came through", () => {
    const fields = [
      field("Spend"), field("Sales"), field("Acos"), field("T.Sales"),
      field("T.Acos"), field("Ads Sales %"), field("Organic Sales %"),
    ];
    expect(agreedColumnsLeftOut("weekly_sales", WEEKLY_HEADERS, fields)).toEqual([]);
  });

  // The one that happened: Acos is spend ÷ sales, so a client with no sales
  // gets #DIV/0! and both Acos columns are dropped on the way in.
  it("names the columns the sheet has but the report lost", () => {
    const fields = [
      field("Spend"), field("Sales"), field("T.Sales"),
      field("Ads Sales %"), field("Organic Sales %"),
    ];
    expect(agreedColumnsLeftOut("weekly_sales", WEEKLY_HEADERS, fields)).toEqual(["Acos", "T.Acos"]);
  });

  // Otherwise every older sheet would report Rating, Reviews and FBA Units as
  // missing on every single send, and bury the line that matters.
  it("says nothing about columns the sheet never had", () => {
    const sparse = ["ASIN", "Name", "Spend", "Sales"];
    const fields = [field("Name", "Blue mug"), field("Spend"), field("Sales")];
    expect(agreedColumnsLeftOut("weekly_sku", sparse, fields)).toEqual([]);
  });

  it("still catches a lost column in a sheet that is missing others", () => {
    const sparse = ["ASIN", "Name", "Spend", "Sales", "Acos"];
    const fields = [field("Name", "Blue mug"), field("Spend"), field("Sales")];
    expect(agreedColumnsLeftOut("weekly_sku", sparse, fields)).toEqual(["Acos"]);
  });

  // Same tolerance the whitelist itself uses, or a sheet writing "T. Acos"
  // would be reported missing when it is right there in the report.
  it("matches spacing and capitalisation the way the whitelist does", () => {
    const headers = ["Week", "Spend", "Sales", "ACOS", "T.Sales", "T. ACOS"];
    const fields = [field("Spend"), field("Sales"), field("ACOS"), field("T.Sales"), field("T. ACOS")];
    expect(agreedColumnsLeftOut("weekly_sales", headers, fields)).toEqual([]);
  });

  // The Monthly Summary heads the same figures differently — see HEADER_ALIASES.
  it("understands the monthly sheet's own wording", () => {
    const headers = ["Month", "Spend", "Ad Orders", "Ad Sales", "Acos", "T.Orders", "T.Sales", "T.Acos"];
    const fields = [
      field("Spend"), field("Ad Orders"), field("Ad Sales"),
      field("T.Orders"), field("T.Sales"), field("T.Acos"),
    ];
    expect(agreedColumnsLeftOut("monthly", headers, fields)).toEqual(["Acos"]);
  });

  // The key column identifies the row rather than being one of its figures,
  // and is deliberately not in REPORT_COLUMNS — so it must never be reported
  // as left out.
  it("never reports the key column", () => {
    const fields = [
      field("Spend"), field("Sales"), field("Acos"), field("T.Sales"),
      field("T.Acos"), field("Ads Sales %"), field("Organic Sales %"),
    ];
    const left = agreedColumnsLeftOut("weekly_sales", WEEKLY_HEADERS, fields);
    expect(left).not.toContain("Week");
  });

  // An internal column is not "left out" — it was never going to a client.
  it("says nothing about internal columns the whitelist excludes", () => {
    const headers = ["Month", "Spend", "Sales", "Acos", "Target Achieved", "Keyword"];
    const fields = [field("Spend"), field("Sales"), field("Acos")];
    expect(agreedColumnsLeftOut("monthly", headers, fields)).toEqual([]);
  });

  // The two halves have to agree: anything onlyAgreedColumns keeps must never
  // also be reported as left out.
  it("never contradicts the filter it reports on", () => {
    const raw = [field("Spend"), field("Acos"), field("Keyword", "crime files")];
    const kept = onlyAgreedColumns("weekly_sales", raw);
    const left = agreedColumnsLeftOut("weekly_sales", WEEKLY_HEADERS, kept);
    for (const f of kept) expect(left).not.toContain(f.label);
  });
});
