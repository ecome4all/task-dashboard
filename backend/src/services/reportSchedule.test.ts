import { describe, it, expect } from "vitest";
import {
  isDue,
  localDateKey,
  readScheduleConfig,
  composeReportMessage,
  composeRunSummary,
  ScheduleConfig,
  RunResult,
} from "./reportSchedule";
import { WeeklyReportPreview } from "./weeklyReportPreview";

// Monday 5 January 2026, 10:00 local.
const MONDAY_10AM = new Date(2026, 0, 5, 10, 0, 0);

function config(overrides: Partial<ScheduleConfig> = {}): ScheduleConfig {
  return { enabled: true, kind: "weekly_sales", dayOfWeek: 1, hour: 10, ...overrides };
}

describe("readScheduleConfig", () => {
  // This sends real messages to real clients. A missing or mistyped variable
  // must never be read as "switch it on".
  it("is off unless the variable is exactly 'true'", () => {
    expect(readScheduleConfig({}).enabled).toBe(false);
    expect(readScheduleConfig({ REPORT_SEND_ENABLED: "false" }).enabled).toBe(false);
    expect(readScheduleConfig({ REPORT_SEND_ENABLED: "yes" }).enabled).toBe(false);
    expect(readScheduleConfig({ REPORT_SEND_ENABLED: "TRUE" }).enabled).toBe(false);
    expect(readScheduleConfig({ REPORT_SEND_ENABLED: "true" }).enabled).toBe(true);
  });

  it("reads a full timetable", () => {
    const c = readScheduleConfig({
      REPORT_SEND_ENABLED: "true",
      REPORT_SEND_KIND: "weekly_sku",
      REPORT_SEND_DAY: "3",
      REPORT_SEND_HOUR: "16",
    });
    expect(c).toEqual({ enabled: true, kind: "weekly_sku", dayOfWeek: 3, hour: 16 });
  });

  it("takes 'every' as every day, for a daily report", () => {
    expect(readScheduleConfig({ REPORT_SEND_DAY: "every" }).dayOfWeek).toBeNull();
  });

  // A wrong value that sends weekly is a smaller mistake than one that sends
  // seven times a week, so a bad day falls back to Monday, not to every day.
  it("falls back to Monday at 10 on rubbish input", () => {
    const c = readScheduleConfig({ REPORT_SEND_DAY: "Monday", REPORT_SEND_HOUR: "9am", REPORT_SEND_KIND: "yearly" });
    expect(c.dayOfWeek).toBe(1);
    expect(c.hour).toBe(10);
    expect(c.kind).toBe("weekly_sales");
  });

  it("rejects an out-of-range day or hour", () => {
    expect(readScheduleConfig({ REPORT_SEND_DAY: "9" }).dayOfWeek).toBe(1);
    expect(readScheduleConfig({ REPORT_SEND_HOUR: "25" }).hour).toBe(10);
    expect(readScheduleConfig({ REPORT_SEND_HOUR: "-1" }).hour).toBe(10);
  });
});

describe("isDue", () => {
  it("fires on the chosen day and hour", () => {
    expect(isDue(config(), MONDAY_10AM, null)).toBe(true);
  });

  it("never fires while switched off", () => {
    expect(isDue(config({ enabled: false }), MONDAY_10AM, null)).toBe(false);
  });

  it("stays quiet on the wrong day or hour", () => {
    expect(isDue(config(), new Date(2026, 0, 6, 10, 0, 0), null)).toBe(false);
    expect(isDue(config(), new Date(2026, 0, 5, 11, 0, 0), null)).toBe(false);
  });

  // The scheduler wakes every five minutes: twelve ticks inside the hour, and
  // each extra one would be a second report to every client.
  it("fires once, not on every tick inside the hour", () => {
    expect(isDue(config(), MONDAY_10AM, null)).toBe(true);
    const alreadyRan = localDateKey(MONDAY_10AM);
    expect(isDue(config(), new Date(2026, 0, 5, 10, 5, 0), alreadyRan)).toBe(false);
    expect(isDue(config(), new Date(2026, 0, 5, 10, 55, 0), alreadyRan)).toBe(false);
  });

  it("comes back the following week", () => {
    expect(isDue(config(), new Date(2026, 0, 12, 10, 0, 0), "2026-01-05")).toBe(true);
  });

  it("runs every day when no day is set", () => {
    const daily = config({ dayOfWeek: null });
    expect(isDue(daily, MONDAY_10AM, null)).toBe(true);
    expect(isDue(daily, new Date(2026, 0, 6, 10, 0, 0), null)).toBe(true);
  });
});

describe("localDateKey", () => {
  // Late evening in India is already the next day in UTC. Keying off UTC
  // would let a Monday round fire on Sunday evening.
  it("uses the local day, not UTC", () => {
    expect(localDateKey(new Date(2026, 0, 5, 23, 30, 0))).toBe("2026-01-05");
  });
});

const REPORT: WeeklyReportPreview = {
  week: 1,
  month: "January",
  sections: [
    { source: "Weekly — January, Week 1", fields: [{ label: "Sales", value: "₹1,462" }, { label: "Acos", value: "37.66%" }] },
  ],
};

describe("composeReportMessage", () => {
  it("greets the client by name and lists the figures", () => {
    const msg = composeReportMessage("Amezia", "weekly_sales", REPORT, MONDAY_10AM);
    expect(msg).toContain("Hi Amezia, here's your update:");
    expect(msg).toContain("*Weekly — January, Week 1*");
    expect(msg).toContain("Sales: ₹1,462");
    expect(msg).toContain("Acos: 37.66%");
    expect(msg).toContain("— Team Ecom4all");
  });

  it("heads each report its own way", () => {
    expect(composeReportMessage("A", "weekly_sales", REPORT, MONDAY_10AM)).toContain("Performance Update — January, Week 1");
    expect(composeReportMessage("A", "weekly_sku", REPORT, MONDAY_10AM)).toContain("SKU Update — January, Week 1");
    expect(composeReportMessage("A", "monthly", REPORT, MONDAY_10AM)).toContain("Monthly Update — January");
  });

  // The server's locale must not decide whether the 5th of August reads as
  // 05/08/2026 or 8/5/2026 — a hosting change would silently flip it.
  it("writes a daily report's date the same way regardless of locale", () => {
    const msg = composeReportMessage("A", "daily", REPORT, new Date(2026, 7, 5, 10, 0, 0));
    expect(msg).toContain("Daily Update — 05/08/2026");
  });

  // Anything we send can come back through the group webhook, and a message
  // starting with the keyword would create a task out of our own report.
  it("never starts with the task keyword", () => {
    expect(composeReportMessage("A", "daily", REPORT, MONDAY_10AM).toLowerCase().startsWith("task:")).toBe(false);
  });
});

describe("composeRunSummary", () => {
  it("says nothing when there was nobody to send to", () => {
    expect(composeRunSummary("weekly_sales", [], MONDAY_10AM)).toBeNull();
  });

  it("names who was sent to", () => {
    const results: RunResult[] = [
      { clientName: "Amezia", sent: true },
      { clientName: "Youbuild", sent: true },
    ];
    const msg = composeRunSummary("weekly_sales", results, MONDAY_10AM)!;
    expect(msg).toContain("Sent to 2 clients");
    expect(msg).toContain("• Amezia");
  });

  // The whole point of the summary: these are the ones needing a person.
  it("separates a failed send from one that was never attempted", () => {
    const results: RunResult[] = [
      { clientName: "Amezia", sent: true },
      { clientName: "Broken Co", sent: false, failed: "Periskope send failed (401)" },
      { clientName: "Quiet Co", sent: false, skipped: "no figures for this period" },
    ];
    const msg = composeRunSummary("daily", results, MONDAY_10AM)!;
    expect(msg).toContain("Failed to send:");
    expect(msg).toContain("Broken Co — Periskope send failed (401)");
    expect(msg).toContain("Nothing sent:");
    expect(msg).toContain("Quiet Co — no figures for this period");
    expect(msg).toContain("Send these by hand");
  });

  it("doesn't ask for hand-holding when everything went out", () => {
    const msg = composeRunSummary("daily", [{ clientName: "Amezia", sent: true }], MONDAY_10AM)!;
    expect(msg).not.toContain("Send these by hand");
  });

  it("is honest when nothing at all was sent", () => {
    const msg = composeRunSummary("daily", [{ clientName: "Quiet Co", sent: false, skipped: "nowhere to send it" }], MONDAY_10AM)!;
    expect(msg).toContain("Sent to 0 clients");
    expect(msg).toContain("• nobody");
  });
});
