import { describe, it, expect } from "vitest";
import {
  isDue,
  localDateKey,
  readScheduleConfig,
  composeReportMessage,
  composeRunSummary,
  hasSomethingToSend,
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
    expect(msg).toContain("Sales: ₹1,462");
    expect(msg).toContain("Acos: 37.66%");
    expect(msg).toContain("— Team Ecom4all");
  });

  // The heading already names the period. Printing the section's own name
  // under it read as a stutter — "Daily — 9 August" directly beneath
  // "Daily Update — 9 August".
  it("doesn't repeat the period it already put in the heading", () => {
    const daily: WeeklyReportPreview = {
      ...REPORT,
      dailyDate: "9 August",
      sections: [{ source: "Daily — 9 August", fields: [{ label: "Spend", value: "402" }] }],
    };
    const msg = composeReportMessage("A", "daily", daily, new Date(2026, 7, 10, 10, 0, 0));
    expect(msg).toContain("Daily Update — 9 August");
    expect(msg).not.toContain("*Daily — 9 August*");
    expect(msg).toContain("Spend: 402");
  });

  // The SKU report is the exception: its sections are products, and the name
  // is the only thing telling one block of figures from the next.
  it("keeps the SKU name, since that is what tells the blocks apart", () => {
    const sku: WeeklyReportPreview = {
      ...REPORT,
      sections: [
        { source: "TR04-B", fields: [{ label: "Sales", value: "₹900" }] },
        { source: "TR05-C", fields: [{ label: "Sales", value: "₹120" }] },
      ],
    };
    const msg = composeReportMessage("A", "weekly_sku", sku, MONDAY_10AM);
    expect(msg).toContain("*TR04-B*");
    expect(msg).toContain("*TR05-C*");
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

  // The day the figures are for, not the day the message goes out. Sheets are
  // filled in a day or two behind, so heading yesterday's numbers with today's
  // date misstates the account.
  it("heads a daily report with the day the figures came from", () => {
    const withDay: WeeklyReportPreview = { ...REPORT, dailyDate: "9 August" };
    expect(composeReportMessage("A", "daily", withDay, new Date(2026, 7, 10, 10, 0, 0))).toContain(
      "Daily Update — 9 August"
    );
  });

  // Ecom4all asked for these: a zero is a real figure about the account —
  // nothing spent, nothing sold — and a line missing from an otherwise
  // complete report raises a question a zero doesn't.
  it("sends noughts like any other figure", () => {
    const withZeros: WeeklyReportPreview = {
      ...REPORT,
      sections: [
        {
          source: "Weekly — January, Week 1",
          fields: [
            { label: "Spend", value: "0" },
            { label: "Sales", value: "₹1,462" },
            { label: "Acos", value: "0.00%" },
          ],
        },
      ],
    };
    const msg = composeReportMessage("A", "weekly_sales", withZeros, MONDAY_10AM);
    expect(msg).toContain("Spend: 0");
    expect(msg).toContain("Sales: ₹1,462");
    expect(msg).toContain("Acos: 0.00%");
  });

  // A section with nothing left in it — every column blank, or an error cell
  // dropped upstream — must not print its own name with no figures under it.
  it("drops a section that has no figures left at all", () => {
    const empty: WeeklyReportPreview = {
      ...REPORT,
      sections: [
        { source: "TR04-B", fields: [] },
        { source: "TR05-C", fields: [{ label: "Sales", value: "₹120" }] },
      ],
    };
    const msg = composeReportMessage("A", "weekly_sku", empty, MONDAY_10AM);
    expect(msg).not.toContain("TR04-B");
    expect(msg).toContain("*TR05-C*");
  });

  // Anything we send can come back through the group webhook, and a message
  // starting with the keyword would create a task out of our own report.
  it("never starts with the task keyword", () => {
    expect(composeReportMessage("A", "daily", REPORT, MONDAY_10AM).toLowerCase().startsWith("task:")).toBe(false);
  });
});

// A client whose whole period reads zero would otherwise be sent a heading, a
// greeting and a sign-off with nothing between them — which is worse than
// saying nothing at all.
describe("hasSomethingToSend", () => {
  it("is true when a real figure survives", () => {
    expect(hasSomethingToSend(REPORT)).toBe(true);
  });

  // A period of genuine zeros is a report — nothing was spent and nothing
  // sold, which is a fact about the account rather than a gap in it.
  it("is true when the figures are all noughts", () => {
    const allZero: WeeklyReportPreview = {
      ...REPORT,
      sections: [
        {
          source: "Weekly — January, Week 1",
          fields: [
            { label: "Spend", value: "0" },
            { label: "Sales", value: "₹0" },
          ],
        },
      ],
    };
    expect(hasSomethingToSend(allZero)).toBe(true);
  });

  it("is false when a section has no figures left in it", () => {
    expect(hasSomethingToSend({ ...REPORT, sections: [{ source: "TR04-B", fields: [] }] })).toBe(false);
  });

  it("is false when the sheet had no rows at all", () => {
    expect(hasSomethingToSend({ week: 1, month: "January", sections: [] })).toBe(false);
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
