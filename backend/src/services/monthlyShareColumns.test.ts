import { describe, it, expect } from "vitest";
import { SheetTab } from "./googleSheets";
import {
  resolveShareColumns,
  correctHeaderSpelling,
  onlyAgreedColumns,
  agreedColumnsLeftOut,
} from "./weeklyReportPreview";
import { findMonthlyRowFields } from "./reportPeriod";
import { ensurePercentSuffix } from "./reportFormatting";

// Amezia's real Monthly Summary, read off the live sheet on 2 Sep 2026.
//
// Three things in this one header row broke the monthly report at once:
// "Ad Sales" appears twice — the money and, eight columns later, the share of
// total sales; the share columns carry no percent sign, so "Organic Sales" was
// not one of the agreed names and never went out; and both shares are stored
// unformatted, as the fraction rather than as "10.58%".
const HEADERS = [
  "Month", "Spend", "Ad Orders", "Ad Sales", "ACOS", "T.Orders", "T.Sales",
  "T.ACOS", "Ad Sales", "Organic Sales", "Target Achived",
];

const AUGUST = [
  "August", "14408.5", "22", "24615.27", "58.53%", "173", "232614.8",
  "6.19%", "0.105819879", "0.894180121", "",
];

describe("resolveShareColumns", () => {
  const resolved = resolveShareColumns(HEADERS);

  it("names the second Ad Sales column for what it holds", () => {
    expect(resolved[8]).toBe("Ads Sales %");
    expect(resolved[9]).toBe("Organic Sales %");
  });

  it("leaves the money column alone", () => {
    expect(resolved[3]).toBe("Ad Sales");
  });

  it("leaves a sheet that already writes the percent sign untouched", () => {
    const already = ["Month", "Spend", "Ad Sales", "Ads Sales %", "Organic Sales %"];
    expect(resolveShareColumns(already)).toEqual(already);
  });

  // Only the organic column identifies the pair, so a lone one is renamed and
  // whatever sits before it is left as it is.
  it("doesn't rename a column that isn't the ads share", () => {
    expect(resolveShareColumns(["Month", "Spend", "Organic Sales"])).toEqual([
      "Month", "Spend", "Organic Sales %",
    ]);
  });
});

// The sheets spell it "Target Achived". That was nobody's problem while the
// column was internal; it became one when it started going to clients.
describe("correctHeaderSpelling", () => {
  it("corrects the one heading the sheets misspell", () => {
    expect(correctHeaderSpelling(["Month", "Spend", "Target Achived"])).toEqual([
      "Month", "Spend", "Target Achieved",
    ]);
  });

  it("leaves a sheet that spells it right alone, and everything else", () => {
    const right = ["Month", "Spend", "Ad Sales", "Target Achieved"];
    expect(correctHeaderSpelling(right)).toEqual(right);
  });
});

describe("the monthly report Amezia would be sent", () => {
  // Fixed, for the reason given in realSheetShapes.test.ts.
  const TODAY = new Date(2026, 8, 3);

  const tab: SheetTab = {
    headers: correctHeaderSpelling(resolveShareColumns(HEADERS)),
    rows: [AUGUST],
  };
  const found = findMonthlyRowFields(tab, "August", 2026, TODAY)!;
  const fields = onlyAgreedColumns("monthly", found).map((f) => ({
    label: f.label,
    value: ensurePercentSuffix(f.label, f.value),
  }));

  it("carries both shares, each read as a percentage", () => {
    expect(fields).toContainEqual({ label: "Ads Sales %", value: "10.58%" });
    expect(fields).toContainEqual({ label: "Organic Sales %", value: "89.42%" });
  });

  it("no longer says Ad Sales twice", () => {
    expect(fields.filter((f) => f.label === "Ad Sales")).toHaveLength(1);
    expect(fields.find((f) => f.label === "Ad Sales")?.value).toBe("24615.27");
  });

  it("leaves the figures that were always right alone", () => {
    expect(fields).toContainEqual({ label: "Spend", value: "14408.5" });
    expect(fields).toContainEqual({ label: "T.ACOS", value: "6.19%" });
  });

  // The column is agreed now, but empty in the sheet. A blank cell is dropped
  // on the way in like any other, so the answer is to fill it in — and the
  // Reports screen says so before anything is sent.
  it("says Target Achieved is missing rather than sending a blank line", () => {
    expect(fields.map((f) => f.label)).not.toContain("Target Achieved");
    expect(agreedColumnsLeftOut("monthly", tab.headers, found)).toContain("Target Achieved");
  });

  // Spelled correctly on the way out, whatever the sheet says.
  it("sends it once the sheet has it", () => {
    const filled: SheetTab = { headers: tab.headers, rows: [[...AUGUST.slice(0, 10), "YES"]] };
    const withTarget = onlyAgreedColumns("monthly", findMonthlyRowFields(filled, "August", 2026, TODAY)!);
    expect(withTarget).toContainEqual({ label: "Target Achieved", value: "YES" });
  });
});
