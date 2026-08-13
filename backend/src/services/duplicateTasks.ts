// The same task landing on the board twice has had three separate causes, and
// all three end the same way: two identical rows, two "Got it, logged" replies
// to the client, two alerts to whoever it lands on.
//
//   - A WhatsApp webhook redelivered. seenMessages.ts catches that, but only
//     within one process — a redelivery straddling a restart still gets through.
//   - Two repeats set up for the same work, firing in the same scheduler pass
//     a second apart. repeatDuplicates.ts stops new ones being made; the pairs
//     already in the database still fire.
//   - "Add a task" submitted twice.
//
// Each of those is worth fixing where it happens, and each has been. This is
// the backstop underneath all of them: the same wording, arriving from the
// same place, within a minute, is not two pieces of work.
//
// A minute is chosen to be far longer than any of the above — a redelivery is
// about five seconds, a double click under one — and far shorter than any real
// repeat, the tightest of which is daily. Nothing legitimate asks for the same
// task twice in the same minute.
export const DUPLICATE_WINDOW_MS = 60 * 1000;

export interface TaskLike {
  description: string;
}

// Wording only. Not the assignee, the type or the marketplace: a redelivered
// message and a double-clicked form produce identical rows anyway, and two
// repeats of the same work differ in none of them either. Case and stray
// spaces are ignored, because one of these usually arrives retyped.
export function isSameWork(a: TaskLike, b: TaskLike): boolean {
  return a.description.trim().toLowerCase() === b.description.trim().toLowerCase();
}

// The already-saved task this one would duplicate, or null if it is new work.
// Candidates are expected to be the tasks from the same chat inside the window
// — see taskRepository.findDuplicateOf.
export function pickDuplicate<T extends TaskLike>(proposed: TaskLike, candidates: T[]): T | null {
  return candidates.find((candidate) => isSameWork(candidate, proposed)) ?? null;
}
