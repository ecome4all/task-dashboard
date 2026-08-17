import { Frequency, FREQUENCY_LABEL, isFrequency } from "./recurrence";

// A repeat is a *copy* of the task it was set up from — nothing links the two
// afterwards (see the recurring-tasks route for why). That is deliberate, but
// it costs one thing: the board can't tell that a task already repeats, so
// "Repeat" looks exactly as unpressed the second time as the first. Press it
// twice on the same task, on two different days, and two repeats quietly run
// side by side, producing two identical tasks every time they fire — a second
// apart, from the same scheduler pass, looking for all the world like a bug in
// task creation.
//
// So the check is: every field that describes the work has to match. Wording,
// client, marketplace, type, employee, how often. One of them different and it
// is different work, which goes through. Case and stray spaces are ignored,
// because the second one is usually set up from a task the wording was copied
// into.
//
// It has to be all of them because the same few task names are what this
// business runs on, and each one is worked separately per client, per
// marketplace and per type. "Ads Optimise" for one customer on Amazon and "Ads
// Optimise" for the same customer on Flipkart are two different jobs done by
// hand in two different places — the wording being identical is the normal way
// of working, not somebody pressing the button twice. Anything narrower than
// the full set refuses real work.
//
// The date of the next run is the one thing deliberately left out. It is not a
// property of the work — it says when the next one fires, and every repeat has
// a different one by the time it has run once. The mistake this guards against
// is pressing "Repeat" again on a task days later, so the date is certain to
// differ exactly when the check needs to fire; counting it would leave nothing
// for the check to catch.
export interface ExistingRepeat {
  description: string;
  clientName: string | null;
  marketplace: string | null;
  taskType: string | null;
  assignee: string | null;
  frequency: string;
  active: boolean;
}

export interface ProposedRepeat {
  description: string;
  clientName: string | null;
  marketplace: string | null;
  taskType: string | null;
  assignee: string | null;
  frequency: string;
}

function sameWording(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function sameName(a: string | null, b: string | null): boolean {
  return (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();
}

// Returns the reason in plain words, or null if this repeat is new work.
// Stopped repeats are not a reason to refuse: turning one back on is a
// deliberate act, and setting a fresh one up in its place is reasonable.
export function whyRepeatWouldDuplicate(
  proposed: ProposedRepeat,
  existing: ExistingRepeat[],
  // Turns "amazon" into "Amazon" for the message. Missing labels fall back to
  // the stored value, so a marketplace an admin added is still named.
  marketplaceLabels: Record<string, string> = {}
): string | null {
  const clash = existing.find(
    (repeat) =>
      repeat.active &&
      sameWording(repeat.description, proposed.description) &&
      sameName(repeat.clientName, proposed.clientName) &&
      sameName(repeat.marketplace, proposed.marketplace) &&
      sameName(repeat.taskType, proposed.taskType) &&
      sameName(repeat.assignee, proposed.assignee) &&
      sameName(repeat.frequency, proposed.frequency)
  );
  if (!clash) return null;

  const howOften = isFrequency(clash.frequency)
    ? FREQUENCY_LABEL[clash.frequency as Frequency].toLowerCase()
    : "on a repeat";

  // Names the client and the marketplace, because those are the two that make
  // one "Ads Optimise" a different job from the next. Without them the refusal
  // reads as though the task name alone were the problem — which is exactly
  // what it used to be, and exactly what was wrong with it.
  const forWhom = clash.clientName ? ` for ${clash.clientName}` : "";
  const where = clash.marketplace
    ? ` on ${marketplaceLabels[clash.marketplace] ?? clash.marketplace}`
    : "";

  return (
    `This task already repeats${forWhom}${where} — ${howOften}. Setting it up ` +
    `again would make two of it every time. Open the Repeating Tasks screen ` +
    `to change when it runs, or to stop it.`
  );
}
