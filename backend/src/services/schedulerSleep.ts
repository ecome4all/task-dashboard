import { ScheduleConfig } from "./reportSchedule";

// How long the scheduler sleeps between passes, worked out from when the next
// piece of work is actually due rather than from a fixed interval.
//
// Why this exists at all: the scheduler used to wake every 5 minutes, day and
// night. Neon — the hosted Postgres this runs on — only suspends the database
// after 5 minutes with nothing asking it anything, and a query every 5 minutes
// means that quiet never arrives. The database therefore billed compute 24
// hours a day to serve a few hundred rows, which is what exhausted the plan's
// monthly compute allowance and took the whole dashboard down with a 502 on
// 1 September. Sleeping until the next due moment lets the database go quiet
// overnight and at weekends, which is most of the week.
//
// Nothing here changes *when* work happens: every job is still driven by the
// stored timestamps it always was. This only decides when to look.

// The shortest gap between passes. Also the retry gap when something failed —
// a repeat whose task couldn't be created hands its claim back and is due
// again immediately, and without a floor that would spin.
export const MIN_SLEEP_MS = 5 * 60 * 1000;

// The longest, regardless of how empty the schedule looks. A backstop against
// sleeping through work that arrived by a route this calculation can't see —
// a clock correction, or a repeat written straight into the database. Repeats
// created on the Repeating Tasks screen don't rely on it: those re-arm the
// timer as soon as they're saved (see rescheduleScheduler in scheduler.ts).
export const MAX_SLEEP_MS = 6 * 60 * 60 * 1000;

// The next time the local clock reads exactly this hour. Strictly after `now`:
// the caller has just finished a pass, so the hour it is currently inside has
// already been handled and waking again inside it would do nothing.
export function nextLocalHour(now: Date, hour: number): Date {
  const candidate = new Date(now);
  candidate.setHours(hour, 0, 0, 0);
  if (candidate.getTime() <= now.getTime()) {
    // setDate rather than adding 24 hours: on a day that isn't 24 hours long
    // this keeps the wall-clock hour, which is the thing being matched.
    candidate.setDate(candidate.getDate() + 1);
    candidate.setHours(hour, 0, 0, 0);
  }
  return candidate;
}

// When the scheduled client report round next comes up, or null when it's
// switched off — which is how it currently ships. See readScheduleConfig.
export function nextReportRunAt(config: ScheduleConfig, now: Date): Date | null {
  if (!config.enabled) return null;

  const candidate = nextLocalHour(now, config.hour);
  if (config.dayOfWeek === null) return candidate;

  const daysAway = (config.dayOfWeek - candidate.getDay() + 7) % 7;
  if (daysAway === 0) return candidate;

  const onTheDay = new Date(candidate);
  onTheDay.setDate(onTheDay.getDate() + daysAway);
  onTheDay.setHours(config.hour, 0, 0, 0);
  return onTheDay;
}

export interface NextWakeInput {
  now: Date;
  // The soonest any active repeat is next due, or null when there are none.
  nextRepeatDueAt: Date | null;
  reminderHour: number;
  reportConfig: ScheduleConfig;
}

// How long to sleep before the next pass: the soonest of everything that could
// need doing, held between the floor and the backstop above.
//
// A moment already in the past — an overdue repeat that failed and was handed
// back — collapses to the floor rather than to zero, so a job that keeps
// failing is retried every 5 minutes instead of in a tight loop.
export function msUntilNextWake({ now, nextRepeatDueAt, reminderHour, reportConfig }: NextWakeInput): number {
  const moments = [nextLocalHour(now, reminderHour)];
  if (nextRepeatDueAt) moments.push(nextRepeatDueAt);

  const reportRun = nextReportRunAt(reportConfig, now);
  if (reportRun) moments.push(reportRun);

  const soonest = Math.min(...moments.map((m) => m.getTime()));
  const wait = soonest - now.getTime();
  return Math.min(MAX_SLEEP_MS, Math.max(MIN_SLEEP_MS, wait));
}
