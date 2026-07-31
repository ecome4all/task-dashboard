export type Frequency = "daily" | "weekly" | "monthly";

export const FREQUENCIES: Frequency[] = ["daily", "weekly", "monthly"];

export function isFrequency(value: unknown): value is Frequency {
  return typeof value === "string" && (FREQUENCIES as string[]).includes(value);
}

export const FREQUENCY_LABEL: Record<Frequency, string> = {
  daily: "Every day",
  weekly: "Every week",
  monthly: "Every month",
};

// Adds one interval to a date. Monthly clamps to the end of a shorter month
// rather than rolling into the next one: a repeat set up on the 31st should
// land on 28 February, not 3 March, and must not drift a day earlier every
// time it does. Because the *stored* nextRunAt is what gets advanced (see
// the RecurringTask model), clamping is applied to that value each time,
// which does mean a monthly repeat created on the 31st stays on the 28th
// after passing through February — acceptable, and far less surprising than
// silently skipping a month.
export function addInterval(from: Date, frequency: Frequency): Date {
  const next = new Date(from);

  if (frequency === "daily") {
    next.setDate(next.getDate() + 1);
    return next;
  }

  if (frequency === "weekly") {
    next.setDate(next.getDate() + 7);
    return next;
  }

  const dayOfMonth = next.getDate();
  // Move to the 1st before changing the month, so setMonth can't overflow
  // (setMonth on the 31st of a month before a 30-day one rolls forward).
  next.setDate(1);
  next.setMonth(next.getMonth() + 1);
  const lastDayOfTargetMonth = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
  next.setDate(Math.min(dayOfMonth, lastDayOfTargetMonth));
  return next;
}

// Where a repeat's clock restarts after a run. A backend that was asleep,
// redeploying, or simply down for a few days must not then fire every run
// it missed in one burst — so this walks forward until it's in the future
// rather than adding a single interval to a long-past date. The result is
// exactly one catch-up run, then a normal cadence.
export function advanceNextRunAt(previousNextRunAt: Date, frequency: Frequency, now: Date): Date {
  let next = addInterval(previousNextRunAt, frequency);
  // Guard against a pathological loop if a clock jumps years: monthly steps
  // reach any realistic "now" in well under a thousand iterations.
  let guard = 0;
  while (next <= now && guard < 1000) {
    next = addInterval(next, frequency);
    guard += 1;
  }
  return next;
}

// The first run of a newly created repeat: one interval after "now", so
// clicking "Repeat this every week" on a task doesn't immediately create a
// duplicate of the task you're looking at.
export function firstRunAt(from: Date, frequency: Frequency): Date {
  return addInterval(from, frequency);
}
