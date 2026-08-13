import { describe, it, expect } from "vitest";
import { whyRepeatWouldDuplicate, ExistingRepeat } from "./repeatDuplicates";

const weekly = (over: Partial<ExistingRepeat> = {}): ExistingRepeat => ({
  description: "Bleeders",
  assignee: "Jayvant",
  frequency: "weekly",
  active: true,
  ...over,
});

describe("whyRepeatWouldDuplicate", () => {
  it("allows a repeat nothing else covers", () => {
    expect(whyRepeatWouldDuplicate({ description: "Bleeders", assignee: "Jayvant" }, [])).toBeNull();
  });

  // The one that happened: "Repeat" pressed on the same task twice, and two
  // identical tasks appearing a second apart on the next scheduler pass.
  it("refuses a second repeat of the same work for the same person", () => {
    const why = whyRepeatWouldDuplicate({ description: "Bleeders", assignee: "Jayvant" }, [weekly()]);
    expect(why).toContain("already repeats");
    expect(why).toContain("every week");
  });

  it("ignores case and stray spaces, because the wording is usually copied", () => {
    expect(
      whyRepeatWouldDuplicate({ description: "  bleeders ", assignee: "jayvant" }, [weekly()])
    ).not.toBeNull();
  });

  // Same words, different person, is genuinely different work.
  it("allows the same work set up for somebody else", () => {
    expect(
      whyRepeatWouldDuplicate({ description: "Bleeders", assignee: "Kinjal Patel" }, [weekly()])
    ).toBeNull();
  });

  it("treats two unassigned repeats of the same wording as duplicates", () => {
    expect(
      whyRepeatWouldDuplicate({ description: "Bleeders", assignee: null }, [weekly({ assignee: null })])
    ).not.toBeNull();
  });

  // Turning a stopped repeat back on is a deliberate act; so is replacing it.
  it("allows setting one up again after the old one was stopped", () => {
    expect(
      whyRepeatWouldDuplicate({ description: "Bleeders", assignee: "Jayvant" }, [weekly({ active: false })])
    ).toBeNull();
  });

  it("says the frequency it found, whichever it is", () => {
    const why = whyRepeatWouldDuplicate({ description: "Bleeders", assignee: "Jayvant" }, [
      weekly({ frequency: "daily" }),
    ]);
    expect(why).toContain("every day");
  });

  // A frequency the app doesn't know about must not produce "every undefined".
  it("copes with a frequency it does not recognise", () => {
    const why = whyRepeatWouldDuplicate({ description: "Bleeders", assignee: "Jayvant" }, [
      weekly({ frequency: "fortnightly" }),
    ]);
    expect(why).toContain("already repeats");
    expect(why).not.toContain("undefined");
  });
});
