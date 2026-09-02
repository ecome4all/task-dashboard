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

  // The Monthly Summary leaves the two share columns unformatted, so they
  // arrive as the fraction Sheets stores rather than as "10.58%". These are
  // Amezia's real August figures.
  describe("a share column that arrives as a bare fraction", () => {
    it("reads it as a share of the whole, not as a number of percent", () => {
      expect(ensurePercentSuffix("Ads Sales %", "0.105819879")).toBe("10.58%");
      expect(ensurePercentSuffix("Organic Sales %", "0.894180121")).toBe("89.42%");
    });

    it("keeps a whole share and an empty one readable", () => {
      expect(ensurePercentSuffix("Organic Sales %", "1")).toBe("100%");
      expect(ensurePercentSuffix("Ads Sales %", "0")).toBe("0%");
    });

    it("leaves a share already scaled to 100 alone", () => {
      expect(ensurePercentSuffix("Ads Sales %", "10.58")).toBe("10.58%");
    });

    // Acos is written "58.53%" in every sheet seen, so a bare "0.5" there is
    // far more likely to be half a percent than half the account.
    it("does not rescale other percentage columns", () => {
      expect(ensurePercentSuffix("Acos", "0.5")).toBe("0.5%");
      expect(ensurePercentSuffix("T.Acos", "0.5")).toBe("0.5%");
    });
  });
});
