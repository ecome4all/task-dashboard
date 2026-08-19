import { describe, it, expect } from "vitest";
import { composeRepeatReminder, daysOpen, OpenRepeatTask } from "./repeatReminder";

// Local time on purpose. daysOpen compares whole days as the person reading
// the message experiences them, so "yesterday evening" has to be built in the
// same clock — a UTC timestamp would land on a different day depending on
// where the test is run.
function at(day: number, hour: number, minute = 0): Date {
  return new Date(2026, 7, day, hour, minute);
}

const STATUS_LABELS = {
  no_action_yet: "No Action Yet",
  started: "Started",
  waiting_for_client: "Waiting for Client",
};

function openTask(overrides: Partial<OpenRepeatTask> = {}): OpenRepeatTask {
  return {
    description: "Ads Optimise",
    clientName: "Dhwani Grug Udhyog",
    status: "no_action_yet",
    dueDate: null,
    createdAt: at(12, 9),
    ...overrides,
  };
}

describe("daysOpen", () => {
  const now = at(19, 9);

  it("counts whole days since the task was made", () => {
    expect(daysOpen(openTask({ createdAt: at(12, 9) }), now)).toBe(7);
  });

  // Compared at the start of each day, so a task made late yesterday reads as
  // a day old this morning rather than as brand new.
  it("counts a task made yesterday evening as one day", () => {
    expect(daysOpen(openTask({ createdAt: at(18, 22, 30) }), now)).toBe(1);
  });

  it("counts a task made earlier today as zero", () => {
    expect(daysOpen(openTask({ createdAt: at(19, 3, 30) }), now)).toBe(0);
  });

  // A repeat whose recorded task somehow carries a later date must not produce
  // "Open since: -3 days ago".
  it("never goes negative", () => {
    expect(daysOpen(openTask({ createdAt: at(22, 9) }), now)).toBe(0);
  });
});

describe("composeRepeatReminder", () => {
  const now = at(19, 9);

  it("names the task, the client and where it has got to", () => {
    const message = composeRepeatReminder("Jayvant", openTask(), STATUS_LABELS, now);

    expect(message).toContain("Hi Jayvant");
    expect(message).toContain("*Ads Optimise*");
    expect(message).toContain("Client: Dhwani Grug Udhyog");
    // The label, not the stored value — nobody reads "no_action_yet".
    expect(message).toContain("Now: No Action Yet");
    expect(message).toContain("Open since: 7 days ago");
    expect(message).toContain("It is due again today");
  });

  it("says yesterday rather than 1 days ago", () => {
    const message = composeRepeatReminder(
      "Jayvant",
      openTask({ createdAt: at(18, 9) }),
      STATUS_LABELS,
      now
    );
    expect(message).toContain("Open since: yesterday");
    expect(message).not.toContain("1 days");
  });

  it("leaves the age out entirely for a task made today", () => {
    const message = composeRepeatReminder(
      "Jayvant",
      openTask({ createdAt: at(19, 3, 30) }),
      STATUS_LABELS,
      now
    );
    expect(message).not.toContain("Open since");
  });

  it("leaves the client line out when the repeat has no client", () => {
    const message = composeRepeatReminder("Jayvant", openTask({ clientName: null }), STATUS_LABELS, now);
    expect(message).not.toContain("Client:");
    expect(message).toContain("*Ads Optimise*");
  });

  // A status that isn't in the dropdown falls back to its stored value rather
  // than printing "undefined".
  it("falls back to the raw status when there is no label for it", () => {
    const message = composeRepeatReminder("Jayvant", openTask({ status: "mystery" }), STATUS_LABELS, now);
    expect(message).toContain("Now: mystery");
  });

  it("shows a due date when the task has one", () => {
    const message = composeRepeatReminder(
      "Jayvant",
      openTask({ dueDate: at(25, 12) }),
      STATUS_LABELS,
      now
    );
    expect(message).toMatch(/Due: 25 Aug 2026/);
  });
});
