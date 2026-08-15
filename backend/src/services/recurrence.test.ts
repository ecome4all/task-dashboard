import { describe, it, expect } from "vitest";
import {
  addInterval,
  advanceNextRunAt,
  firstRunAt,
  isFrequency,
  FREQUENCIES,
  FREQUENCY_LABEL,
} from "./recurrence";

function d(iso: string): Date {
  return new Date(iso);
}

describe("isFrequency", () => {
  it("accepts the known frequencies and rejects anything else", () => {
    expect(isFrequency("daily")).toBe(true);
    expect(isFrequency("weekly")).toBe(true);
    expect(isFrequency("fortnightly")).toBe(true);
    expect(isFrequency("monthly")).toBe(true);
    expect(isFrequency("yearly")).toBe(false);
    expect(isFrequency("biweekly")).toBe(false);
    expect(isFrequency("")).toBe(false);
    expect(isFrequency(undefined)).toBe(false);
  });

  // Both dropdowns read the keys of FREQUENCY_LABEL, and the scheduler
  // switches on the value — a frequency in one and not the other is either an
  // option that can't be saved or a saved value that never advances.
  it("labels every frequency it accepts", () => {
    for (const freq of FREQUENCIES) {
      expect(FREQUENCY_LABEL[freq]).toBeTruthy();
    }
    expect(Object.keys(FREQUENCY_LABEL).sort()).toEqual([...FREQUENCIES].sort());
  });
});

describe("addInterval", () => {
  it("adds a day", () => {
    expect(addInterval(d("2026-07-30T09:00:00Z"), "daily").toISOString()).toContain("2026-07-31");
  });

  it("adds a week", () => {
    expect(addInterval(d("2026-07-30T09:00:00Z"), "weekly").toISOString()).toContain("2026-08-06");
  });

  it("adds two weeks", () => {
    expect(addInterval(d("2026-07-30T09:00:00Z"), "fortnightly").toISOString()).toContain("2026-08-13");
  });

  // Same weekday every time is the point of counting days rather than
  // stepping half a month.
  it("keeps a fortnightly repeat on the same weekday across a month end", () => {
    const start = d("2026-08-27T09:00:00Z"); // Thursday
    const next = addInterval(start, "fortnightly");
    expect(next.toISOString()).toContain("2026-09-10");
    expect(next.getUTCDay()).toBe(start.getUTCDay());
  });

  it("adds a month", () => {
    expect(addInterval(d("2026-07-15T09:00:00Z"), "monthly").toISOString()).toContain("2026-08-15");
  });

  it("clamps to the last day of a shorter month instead of rolling into the next one", () => {
    // 31 Jan + 1 month must land in February, not on 3 March.
    const next = addInterval(d("2026-01-31T09:00:00Z"), "monthly");
    expect(next.getMonth()).toBe(1); // February
    expect(next.getDate()).toBe(28);
  });

  it("crosses a year boundary", () => {
    const next = addInterval(d("2026-12-10T09:00:00Z"), "monthly");
    expect(next.getFullYear()).toBe(2027);
    expect(next.getMonth()).toBe(0);
  });
});

describe("advanceNextRunAt", () => {
  it("moves one interval forward in the normal case", () => {
    const now = d("2026-07-30T09:05:00Z");
    const next = advanceNextRunAt(d("2026-07-30T09:00:00Z"), "daily", now);
    expect(next.toISOString()).toContain("2026-07-31");
  });

  // The whole point of storing nextRunAt: a backend that was down for a week
  // catches up with one run, not seven.
  it("skips past a long outage rather than replaying every missed run", () => {
    const now = d("2026-07-30T09:00:00Z");
    const next = advanceNextRunAt(d("2026-07-01T09:00:00Z"), "daily", now);
    expect(next.getTime()).toBeGreaterThan(now.getTime());
    // Next run is the very next day after now, not 2 July.
    expect(next.toISOString()).toContain("2026-07-31");
  });

  it("always returns a time in the future", () => {
    const now = d("2026-07-30T09:00:00Z");
    for (const freq of FREQUENCIES) {
      expect(advanceNextRunAt(d("2026-01-01T09:00:00Z"), freq, now).getTime()).toBeGreaterThan(now.getTime());
    }
  });
});

describe("firstRunAt", () => {
  // Otherwise clicking "repeat this weekly" would immediately create a
  // duplicate of the task you're looking at.
  it("is one interval out, never immediately", () => {
    const now = d("2026-07-30T09:00:00Z");
    expect(firstRunAt(now, "weekly").getTime()).toBeGreaterThan(now.getTime());
    expect(firstRunAt(now, "weekly").toISOString()).toContain("2026-08-06");
  });
});
