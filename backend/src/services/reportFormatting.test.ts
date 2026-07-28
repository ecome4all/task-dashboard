import { describe, it, expect } from "vitest";
import { ensurePercentSuffix } from "./reportFormatting";

describe("ensurePercentSuffix", () => {
  it("appends % to a percentage-type column missing it", () => {
    expect(ensurePercentSuffix("Acos", "12.76")).toBe("12.76%");
    expect(ensurePercentSuffix("Ads Sales %", "67.59")).toBe("67.59%");
  });

  it("leaves a value that already ends in % untouched", () => {
    expect(ensurePercentSuffix("Acos", "12.76%")).toBe("12.76%");
  });

  it("leaves non-percentage columns untouched either way", () => {
    expect(ensurePercentSuffix("Spend", "12500")).toBe("12500");
    expect(ensurePercentSuffix("T.Sales", "145000")).toBe("145000");
  });

  it("matches T.Acos and Organic Sales % as percentage columns too", () => {
    expect(ensurePercentSuffix("T.Acos", "8.62")).toBe("8.62%");
    expect(ensurePercentSuffix("Organic Sales %", "32.41")).toBe("32.41%");
  });
});
