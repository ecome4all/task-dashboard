import { describe, it, expect } from "vitest";
import { composeEmployeeReminder, isLate, ReminderTask } from "./reminderMessages";

const NOW = new Date("2026-07-30T09:00:00");
const LABELS = { started: "Started", submitted: "Submitted", done: "Done" };

function task(overrides: Partial<ReminderTask> = {}): ReminderTask {
  return {
    description: "Fix the listing",
    status: "started",
    clientName: "BagsGuru",
    dueDate: null,
    ...overrides,
  };
}

describe("isLate", () => {
  it("is late once the due date has passed", () => {
    expect(isLate(task({ dueDate: new Date("2026-07-29T00:00:00") }), NOW)).toBe(true);
  });

  // A task due today isn't late at 9am — otherwise every due-today task
  // would be reported as late from midnight onwards.
  it("is not late on the day it's due", () => {
    expect(isLate(task({ dueDate: new Date("2026-07-30T00:00:00") }), NOW)).toBe(false);
  });

  it("is not late with no due date at all", () => {
    expect(isLate(task({ dueDate: null }), NOW)).toBe(false);
  });
});

describe("composeEmployeeReminder", () => {
  // A reminder that arrives every morning saying "you have nothing" is how
  // people learn to ignore reminders.
  it("returns null when there's nothing open, so nothing gets sent", () => {
    expect(composeEmployeeReminder("Shivani", [], LABELS, NOW)).toBeNull();
  });

  it("greets the employee by name", () => {
    const message = composeEmployeeReminder("Shivani", [task()], LABELS, NOW);
    expect(message).toContain("Shivani");
  });

  it("groups late, due-today and the rest under their own headings", () => {
    const message = composeEmployeeReminder(
      "Shivani",
      [
        task({ description: "Late one", dueDate: new Date("2026-07-28T00:00:00") }),
        task({ description: "Today one", dueDate: new Date("2026-07-30T00:00:00") }),
        task({ description: "Someday one", dueDate: null }),
      ],
      LABELS,
      NOW
    )!;

    expect(message).toContain("*Late (1)*");
    expect(message).toContain("*Due today (1)*");
    expect(message).toContain("*Still open (1)*");
    // Late work comes first — it's the part that needs acting on today.
    expect(message.indexOf("Late one")).toBeLessThan(message.indexOf("Today one"));
    expect(message.indexOf("Today one")).toBeLessThan(message.indexOf("Someday one"));
  });

  it("shows the client name and the readable status label", () => {
    const message = composeEmployeeReminder("Shivani", [task({ status: "submitted" })], LABELS, NOW)!;
    expect(message).toContain("BagsGuru");
    expect(message).toContain("Submitted");
    expect(message).not.toContain("submitted —");
  });

  it("falls back to the raw status when there's no label for it", () => {
    const message = composeEmployeeReminder("Shivani", [task({ status: "brand_new" })], LABELS, NOW)!;
    expect(message).toContain("brand_new");
  });

  it("omits a heading for a group that has nothing in it", () => {
    const message = composeEmployeeReminder("Shivani", [task({ dueDate: null })], LABELS, NOW)!;
    expect(message).not.toContain("Late (");
    expect(message).not.toContain("Due today (");
    expect(message).toContain("Still open (1)");
  });
});
