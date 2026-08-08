import { describe, it, expect } from "vitest";
import { shouldAnnounceStageChange } from "./taskMessages";

// "The group gets an automatic message every time a request's stage changes"
// — the line this rule exists to keep.
describe("shouldAnnounceStageChange", () => {
  it("announces every stage, not only Done", () => {
    for (const stage of ["submitted", "waiting_for_amazon", "again_submitted", "done"]) {
      expect(
        shouldAnnounceStageChange({ statusInRequest: true, previousStatus: "started", newStatus: stage })
      ).toBe(true);
    }
  });

  // A client reading "status changed to Submitted" about a task that was
  // already Submitted learns nothing and trusts the next message less.
  it("stays quiet when the stage was re-picked at the same value", () => {
    expect(
      shouldAnnounceStageChange({ statusInRequest: true, previousStatus: "submitted", newStatus: "submitted" })
    ).toBe(false);
  });

  it("stays quiet when the edit never touched the stage", () => {
    expect(
      shouldAnnounceStageChange({ statusInRequest: false, previousStatus: "started", newStatus: "started" })
    ).toBe(false);
  });

  // A task's first stage still counts as a change — there was nothing before.
  it("announces the first stage a task is given", () => {
    expect(
      shouldAnnounceStageChange({ statusInRequest: true, previousStatus: null, newStatus: "started" })
    ).toBe(true);
  });

  // The switch exists because this is the one feature that messages a client
  // on someone else's schedule.
  it("can be switched off without a deploy", () => {
    expect(
      shouldAnnounceStageChange({ statusInRequest: true, previousStatus: "started", newStatus: "done", disabled: true })
    ).toBe(false);
  });
});
