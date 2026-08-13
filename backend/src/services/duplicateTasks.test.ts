import { describe, it, expect } from "vitest";
import { isSameWork, pickDuplicate, DUPLICATE_WINDOW_MS } from "./duplicateTasks";

describe("isSameWork", () => {
  it("matches the same wording", () => {
    expect(isSameWork({ description: "Bleeders" }, { description: "Bleeders" })).toBe(true);
  });

  // A redelivered webhook is byte-identical, but a re-submitted form usually
  // isn't quite.
  it("ignores case and stray spaces", () => {
    expect(isSameWork({ description: " bleeders " }, { description: "Bleeders" })).toBe(true);
  });

  it("does not match different work", () => {
    expect(isSameWork({ description: "Bleeders" }, { description: "Bleeders-2" })).toBe(false);
  });
});

describe("pickDuplicate", () => {
  it("finds nothing among unrelated tasks", () => {
    expect(
      pickDuplicate({ description: "Bleeders" }, [{ description: "Something else" }])
    ).toBeNull();
  });

  it("finds nothing when there is nothing recent at all", () => {
    expect(pickDuplicate({ description: "Bleeders" }, [])).toBeNull();
  });

  it("returns the task it would duplicate", () => {
    const existing = { id: "task-1", description: "Bleeders" };
    expect(pickDuplicate({ description: "Bleeders" }, [existing])).toBe(existing);
  });

  // Candidates arrive newest first, and the newest is the one a second
  // delivery is a copy of.
  it("returns the most recent match when there are several", () => {
    const newest = { id: "task-2", description: "Bleeders" };
    const older = { id: "task-1", description: "Bleeders" };
    expect(pickDuplicate({ description: "Bleeders" }, [newest, older])).toBe(newest);
  });
});

describe("the window", () => {
  // Long enough to cover a ~5s webhook redelivery and a double click; far
  // short of the tightest real repeat, which is daily.
  it("is a minute", () => {
    expect(DUPLICATE_WINDOW_MS).toBe(60_000);
  });
});
