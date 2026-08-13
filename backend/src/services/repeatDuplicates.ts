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
// person. Case and stray spaces are ignored, because the second one is usually
// set up from a task the wording was copied into.
export interface ExistingRepeat {
  description: string;
  assignee: string | null;
  frequency: string;
  active: boolean;
}

export interface ProposedRepeat {
  description: string;
  assignee: string | null;
}

function sameWording(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function samePerson(a: string | null, b: string | null): boolean {
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
      samePerson(repeat.assignee, proposed.assignee)
  );
  if (!clash) return null;

  const howOften = isFrequency(clash.frequency)
    ? FREQUENCY_LABEL[clash.frequency as Frequency].toLowerCase()
    : "on a repeat";

  return (
    `This task already repeats — ${howOften}. Setting it up again would make ` +
    `two of it every time. Open the Repeating Tasks screen to change when it ` +
    `runs, or to stop it.`
  );
}
