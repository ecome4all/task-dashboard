import { ReportKind, REPORT_KIND_LABEL, WeeklyReportPreview, isReportKind } from "./weeklyReportPreview";
import { isZeroValue } from "./reportPeriod";

// Gap between one client's message and the next. WhatsApp treats a burst of
// identical-looking messages from one number as spam, and the account being
// throttled would cost far more than the round taking a minute longer.
export const SEND_GAP_MS = 5000;

export interface ScheduleConfig {
  enabled: boolean;
  kind: ReportKind;
  // 0 = Sunday ... 6 = Saturday. Null means every day.
  dayOfWeek: number | null;
  hour: number;
}

// The timetable is one fixed setting for every client — same report, same day,
// same hour — so it lives in environment variables rather than in the
// database. That's the same place REMINDER_HOUR already lives for the daily
// staff reminder, and it keeps a table out of Postgres whose every row would
// have been identical.
//
// The trade is that changing the day or time is a hosting change, not a
// Settings screen. Worth revisiting only if it starts varying per client.
//
// Off unless REPORT_SEND_ENABLED is exactly "true": this sends real messages
// to real clients, so it must never switch itself on because a variable was
// mistyped or missing.
export function readScheduleConfig(env: NodeJS.ProcessEnv = process.env): ScheduleConfig {
  const kind = env.REPORT_SEND_KIND;
  const day = env.REPORT_SEND_DAY;
  const hour = Number(env.REPORT_SEND_HOUR);

  return {
    enabled: env.REPORT_SEND_ENABLED === "true",
    kind: isReportKind(kind) ? kind : "weekly_sales",
    // "every" is how a daily report is asked for; anything unrecognised falls
    // back to Monday rather than to every day, since a wrong value that sends
    // weekly is a smaller mistake than one that sends seven times a week.
    dayOfWeek: day === "every" ? null : Number.isInteger(Number(day)) && Number(day) >= 0 && Number(day) <= 6 ? Number(day) : 1,
    hour: Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : 10,
  };
}

// The date part of a moment, used as the "already run today" key. Local
// rather than UTC on purpose: the timetable is set in the team's own working
// day ("Monday at 10"), and near midnight UTC those two disagree about which
// day it is — which would fire the Monday round on Sunday evening India time.
export function localDateKey(now: Date): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// Whether the round should start on this tick. The scheduler wakes every five
// minutes, so this is true on several ticks inside the chosen hour — lastRunOn
// is what makes the round happen once.
export function isDue(config: ScheduleConfig, now: Date, lastRunOn: string | null): boolean {
  if (!config.enabled) return false;
  if (config.dayOfWeek !== null && now.getDay() !== config.dayOfWeek) return false;
  if (now.getHours() !== config.hour) return false;
  return lastRunOn !== localDateKey(now);
}

// Dates are written the same way for every client, so this doesn't depend on
// the server's locale — a hosting change moving it from en-IN to en-US would
// otherwise silently start writing 8/5/2026 for the 5th of August.
function formatDay(date: Date): string {
  return `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}`;
}

function reportHeading(kind: ReportKind, report: WeeklyReportPreview, now: Date): string {
  // The day the figures are for, not the day the message is sent. The sheets
  // are filled in a day or two behind, so those are usually different days,
  // and heading yesterday's numbers with today's date misstates the account.
  if (kind === "daily") return `📊 *Daily Update — ${report.dailyDate ?? formatDay(now)}*`;
  if (kind === "weekly_sku") return `📦 *SKU Update — ${report.month}, Week ${report.week}*`;
  if (kind === "monthly") return `📊 *Monthly Update — ${report.month}*`;
  return `📊 *Performance Update — ${report.month}, Week ${report.week}*`;
}

// The message a client receives. Deliberately identical in shape to the one
// the Weekly Reports screen composes by hand (see composeMessage in
// frontend/src/WeeklyReports.tsx) — a client must not be able to tell whether
// a report was sent by a person or by the timetable. If either is changed,
// change both.
//
// Must never start with "task:" — this goes out on the same connected number
// the group channel uses, and anything we send can come back through the
// webhook. See parser/noLoop.test.ts.
export function composeReportMessage(
  clientName: string,
  kind: ReportKind,
  report: WeeklyReportPreview,
  now: Date
): string {
  const lines = [reportHeading(kind, report, now), `Hi ${clientName}, here's your update:`];

  for (const section of report.sections) {
    // Zeros are left out, the same as they are left unticked on the Reports
    // screen: "Spend: 0, Order: 0, Sales: 0" tells a client nothing. Nobody is
    // here to untick them on a scheduled send, so it is done for them.
    const worthSending = section.fields.filter((f) => !isZeroValue(f.value));
    if (worthSending.length === 0) continue;

    lines.push("");
    // Only the SKU report names its sections. Its sections are products, and
    // the name is the only thing telling them apart. Every other report has
    // one section covering the period the heading already names, so printing
    // it again just says "Daily — 9 August" under "Daily Update — 9 August".
    if (kind === "weekly_sku") lines.push(`*${section.source}*`);

    for (const field of worthSending) lines.push(`${field.label}: ${field.value}`);
  }

  lines.push("", "— Team Ecom4all");
  return lines.join("\n");
}

// Whether there is a report here at all. Sections can exist and still hold
// nothing worth sending — a period filled in as all zeros — and without this
// that client would get the heading, the greeting and the sign-off with no
// figures between them.
export function hasSomethingToSend(report: WeeklyReportPreview): boolean {
  return report.sections.some((section) => section.fields.some((f) => !isZeroValue(f.value)));
}

export type SkipReason = "no figures for this period" | "nowhere to send it" | "couldn't open the sheet";

export interface RunResult {
  clientName: string;
  sent: boolean;
  // Why nothing was sent to this client. Absent when sent is true.
  skipped?: SkipReason;
  // Set when the send itself was attempted and failed, as opposed to being
  // skipped before it was tried.
  failed?: string;
}

// What the team is told after the round. This is the only record anyone sees
// that it happened at all: the messages went to clients, not to staff, so
// without this a silent failure — an expired WhatsApp session, a sheet nobody
// filled in — looks exactly like a quiet week.
export function composeRunSummary(kind: ReportKind, results: RunResult[], now: Date): string | null {
  if (results.length === 0) return null;

  const sent = results.filter((r) => r.sent);
  const failed = results.filter((r) => r.failed);
  const skipped = results.filter((r) => r.skipped);

  const lines = [
    `📤 ${REPORT_KIND_LABEL[kind]} — sent automatically on ${formatDay(now)}`,
    "",
    `*Sent to ${sent.length} client${sent.length === 1 ? "" : "s"}:*`,
  ];
  if (sent.length > 0) {
    for (const r of sent) lines.push(`• ${r.clientName}`);
  } else {
    lines.push("• nobody");
  }

  if (failed.length > 0) {
    lines.push("", "*Failed to send:*");
    for (const r of failed) lines.push(`• ${r.clientName} — ${r.failed}`);
  }

  if (skipped.length > 0) {
    lines.push("", "*Nothing sent:*");
    for (const r of skipped) lines.push(`• ${r.clientName} — ${r.skipped}`);
  }

  if (failed.length > 0 || skipped.length > 0) {
    lines.push("", "Send these by hand from Weekly Reports once fixed.");
  }

  lines.push("", "— Task Dashboard");
  return lines.join("\n");
}
