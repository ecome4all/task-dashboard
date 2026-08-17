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
// So the check has to be on what a repeat is made of: same wording, same
// client, same person, same how-often. Case and stray spaces are ignored,
// because the second one is usually set up from a task the wording was copied
// into.
//
// The client and the how-often are part of that identity because the same few
// task names are used for every client this business runs — "Bleeders" for one
// customer on Monday and "Bleeders" for another on Thursday is the normal way
// of working, not somebody pressing the button twice. Only the four together
// mean "you have already set this up".
//
// The date of the next run is deliberately *not* part of it. The mistake this
// guards against is pressing "Repeat" again on a task days later, and the date
// is the one thing certain to differ when that happens — counting it would let
// through exactly the case the check exists for.
export interface ExistingRepeat {
  description: string;
  clientName: string | null;
  assignee: string | null;
  frequency: string;
  active: boolean;
}

export interface ProposedRepeat {
  description: string;
  clientName: string | null;
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
  existing: ExistingRepeat[]
): string | null {
  const clash = existing.find(
    (repeat) =>
      repeat.active &&
      sameWording(repeat.description, proposed.description) &&
      sameName(repeat.clientName, proposed.clientName) &&
      sameName(repeat.assignee, proposed.assignee) &&
      sameName(repeat.frequency, proposed.frequency)
  );
  if (!clash) return null;

  const howOften = isFrequency(clash.frequency)
    ? FREQUENCY_LABEL[clash.frequency as Frequency].toLowerCase()
    : "on a repeat";

  // Names the client, so that on a board where ten clients share this task
  // wording it is clear which one is already covered.
  const forWhom = clash.clientName ? ` for ${clash.clientName}` : "";

  return (
    `This task already repeats${forWhom} — ${howOften}. Setting it up again ` +
    `would make two of it every time. Open the Repeating Tasks screen to ` +
    `change when it runs, or to stop it.`
  );
}
