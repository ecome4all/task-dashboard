import { describe, it, expect } from "vitest";
import {
  MAX_SLEEP_MS,
  MIN_SLEEP_MS,
  msUntilNextWake,
  nextLocalHour,
  nextReportRunAt,
} from "./schedulerSleep";
import { ScheduleConfig } from "./reportSchedule";

const OFF: ScheduleConfig = { enabled: false, kind: "weekly_sales", dayOfWeek: 1, hour: 10 };

// Local time throughout, because that's the clock every job here is set
// against — see the localDateKey note in reportSchedule.
const at = (iso: string) => new Date(iso);
const minutes = (ms: number) => ms / 60000;

describe("nextLocalHour", () => {
  it("finds the hour later the same day", () => {
    expect(nextLocalHour(at("2026-09-01T06:30:00"), 9).getHours()).toBe(9);
    expect(nextLocalHour(at("2026-09-01T06:30:00"), 9).getDate()).toBe(1);
  });

  it("rolls to tomorrow once the hour has passed", () => {
    const next = nextLocalHour(at("2026-09-01T14:00:00"), 9);
    expect(next.getDate()).toBe(2);
    expect(next.getHours()).toBe(9);
  });

  // The pass that just ran already handled this hour; waking inside it again
  // would find the "already sent today" guard and do nothing.
  it("treats the hour it is currently inside as gone", () => {
    const next = nextLocalHour(at("2026-09-01T09:00:00"), 9);
    expect(next.getDate()).toBe(2);
  });

  it("lands on the exact hour, not a moment past it", () => {
    const next = nextLocalHour(at("2026-09-01T06:30:45.500"), 9);
    expect([next.getMinutes(), next.getSeconds(), next.getMilliseconds()]).toEqual([0, 0, 0]);
  });
});

describe("nextReportRunAt", () => {
  it("is null while the round is switched off", () => {
    expect(nextReportRunAt(OFF, at("2026-09-01T08:00:00"))).toBeNull();
  });

  it("finds the next chosen weekday", () => {
    // 1 Sep 2026 is a Tuesday; the round is set for Monday.
    const next = nextReportRunAt({ ...OFF, enabled: true }, at("2026-09-01T08:00:00"));
    expect(next?.getDay()).toBe(1);
    expect(next?.getDate()).toBe(7);
    expect(next?.getHours()).toBe(10);
  });

  it("uses today when today is the day and the hour is still ahead", () => {
    const next = nextReportRunAt({ ...OFF, enabled: true, dayOfWeek: 2 }, at("2026-09-01T08:00:00"));
    expect(next?.getDate()).toBe(1);
  });

  it("takes tomorrow for a daily round once today's hour has gone", () => {
    const next = nextReportRunAt({ ...OFF, enabled: true, dayOfWeek: null }, at("2026-09-01T11:00:00"));
    expect(next?.getDate()).toBe(2);
    expect(next?.getHours()).toBe(10);
  });
});

describe("msUntilNextWake", () => {
  // The whole point of the change: nothing due until the morning means the
  // database is left alone, so Neon can suspend it instead of billing compute
  // through the night.
  it("sleeps for hours when the next repeat is tomorrow morning", () => {
    const wait = msUntilNextWake({
      now: at("2026-09-01T22:00:00"),
      nextRepeatDueAt: at("2026-09-02T09:00:00"),
      reminderHour: 9,
      reportConfig: OFF,
    });
    expect(minutes(wait)).toBe(minutes(MAX_SLEEP_MS));
    expect(wait).toBeGreaterThan(60 * 60 * 1000);
  });

  it("wakes for the repeat when that is sooner than the reminder", () => {
    const wait = msUntilNextWake({
      now: at("2026-09-01T10:00:00"),
      nextRepeatDueAt: at("2026-09-01T11:00:00"),
      reminderHour: 9,
      reportConfig: OFF,
    });
    expect(minutes(wait)).toBe(60);
  });

  it("wakes for the daily reminder when that is sooner than the repeat", () => {
    const wait = msUntilNextWake({
      now: at("2026-09-01T08:00:00"),
      nextRepeatDueAt: at("2026-09-01T12:00:00"),
      reminderHour: 9,
      reportConfig: OFF,
    });
    expect(minutes(wait)).toBe(60);
  });

  it("wakes for the report round when that is soonest", () => {
    const wait = msUntilNextWake({
      now: at("2026-09-01T08:00:00"),
      nextRepeatDueAt: at("2026-09-01T12:00:00"),
      reminderHour: 9,
      reportConfig: { ...OFF, enabled: true, dayOfWeek: 2, hour: 8 },
    });
    // 08:00 today has gone, so the next Tuesday 08:00 is a week away; the
    // reminder at 09:00 is what's left as soonest.
    expect(minutes(wait)).toBe(60);
  });

  // A repeat that failed hands its claim back and is due again straight away.
  // Without the floor this would re-run with no gap at all.
  it("never goes below the floor for an overdue repeat", () => {
    const wait = msUntilNextWake({
      now: at("2026-09-01T10:00:00"),
      nextRepeatDueAt: at("2026-09-01T09:00:00"),
      reminderHour: 9,
      reportConfig: OFF,
    });
    expect(wait).toBe(MIN_SLEEP_MS);
  });

  it("never goes below the floor for a repeat due in seconds", () => {
    const wait = msUntilNextWake({
      now: at("2026-09-01T10:00:00"),
      nextRepeatDueAt: at("2026-09-01T10:00:30"),
      reminderHour: 9,
      reportConfig: OFF,
    });
    expect(wait).toBe(MIN_SLEEP_MS);
  });

  it("still wakes for the reminder when there are no repeats at all", () => {
    const wait = msUntilNextWake({
      now: at("2026-09-01T08:00:00"),
      nextRepeatDueAt: null,
      reminderHour: 9,
      reportConfig: OFF,
    });
    expect(minutes(wait)).toBe(60);
  });

  it("is capped by the backstop even with nothing scheduled for a day", () => {
    const wait = msUntilNextWake({
      now: at("2026-09-01T10:00:00"),
      nextRepeatDueAt: null,
      reminderHour: 9,
      reportConfig: OFF,
    });
    expect(wait).toBe(MAX_SLEEP_MS);
  });

  // The four repeat hours the client actually uses. Walking them proves the
  // scheduler lands on each in turn rather than skipping one.
  it("steps through a morning of repeats one at a time", () => {
    const hours = ["09:00", "10:00", "11:00", "12:00"];
    for (const [i, hour] of hours.slice(0, -1).entries()) {
      const wait = msUntilNextWake({
        now: at(`2026-09-01T${hour}:00`),
        nextRepeatDueAt: at(`2026-09-01T${hours[i + 1]}:00`),
        reminderHour: 9,
        reportConfig: OFF,
      });
      expect(minutes(wait)).toBe(60);
    }
  });
});
