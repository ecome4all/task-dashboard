import { describe, it, expect } from "vitest";
import { whyRepeatWouldDuplicate, ExistingRepeat, ProposedRepeat } from "./repeatDuplicates";

const weekly = (over: Partial<ExistingRepeat> = {}): ExistingRepeat => ({
  description: "Bleeders",
  clientName: "Kapiva",
  assignee: "Jayvant",
  frequency: "weekly",
  active: true,
  ...over,
});

// The same repeat, as it arrives from the "Repeat" button — so each test below
// varies only the one thing it is about.
const proposed = (over: Partial<ProposedRepeat> = {}): ProposedRepeat => ({
  description: "Bleeders",
  clientName: "Kapiva",
  assignee: "Jayvant",
  frequency: "weekly",
  ...over,
});

describe("whyRepeatWouldDuplicate", () => {
  it("allows a repeat nothing else covers", () => {
    expect(whyRepeatWouldDuplicate(proposed(), [])).toBeNull();
  });

  // The one that happened: "Repeat" pressed on the same task twice, and two
  // identical tasks appearing a second apart on the next scheduler pass.
  it("refuses a second repeat of the same work for the same person", () => {
    const why = whyRepeatWouldDuplicate(proposed(), [weekly()]);
    expect(why).toContain("already repeats");
    expect(why).toContain("every week");
  });

  it("ignores case and stray spaces, because the wording is usually copied", () => {
    expect(
      whyRepeatWouldDuplicate(
        proposed({ description: "  bleeders ", clientName: " kapiva", assignee: "jayvant" }),
        [weekly()]
      )
    ).not.toBeNull();
  });

  // Same words, different person, is genuinely different work.
  it("allows the same work set up for somebody else", () => {
    expect(whyRepeatWouldDuplicate(proposed({ assignee: "Kinjal Patel" }), [weekly()])).toBeNull();
  });

  // The whole business runs the same few task names across every client, so
  // this is the normal way of working rather than a double press.
  it("allows the same task name set up for a different client", () => {
    expect(whyRepeatWouldDuplicate(proposed({ clientName: "Mamaearth" }), [weekly()])).toBeNull();
  });

  it("allows the same task for the same client on a different how-often", () => {
    expect(whyRepeatWouldDuplicate(proposed({ frequency: "daily" }), [weekly()])).toBeNull();
  });

  it("names the client it clashed with, so it is clear which one is covered", () => {
    expect(whyRepeatWouldDuplicate(proposed(), [weekly()])).toContain("for Kapiva");
  });

  it("leaves the client out of the message when there isn't one", () => {
    const why = whyRepeatWouldDuplicate(proposed({ clientName: null }), [weekly({ clientName: null })]);
    expect(why).toContain("already repeats —");
    expect(why).not.toContain("for null");
  });

  it("treats two unassigned repeats of the same wording as duplicates", () => {
    expect(
      whyRepeatWouldDuplicate(proposed({ assignee: null }), [weekly({ assignee: null })])
    ).not.toBeNull();
  });

  // Turning a stopped repeat back on is a deliberate act; so is replacing it.
  it("allows setting one up again after the old one was stopped", () => {
    expect(whyRepeatWouldDuplicate(proposed(), [weekly({ active: false })])).toBeNull();
  });

  it("says the frequency it found, whichever it is", () => {
    const why = whyRepeatWouldDuplicate(proposed({ frequency: "daily" }), [
      weekly({ frequency: "daily" }),
    ]);
    expect(why).toContain("every day");
  });

  // A frequency the app doesn't know about must not produce "every undefined".
  it("copes with a frequency it does not recognise", () => {
    const why = whyRepeatWouldDuplicate(proposed({ frequency: "fortnightly" }), [
      weekly({ frequency: "fortnightly" }),
    ]);
    expect(why).toContain("already repeats");
    expect(why).not.toContain("undefined");
  });
});
