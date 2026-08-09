// Remembers which incoming WhatsApp messages have already been handled, so a
// redelivery of the same one doesn't become a second task.
//
// This is not hypothetical. The webhook does real work before it answers —
// a Periskope call for the chat name, the task write, the "Got it, logged"
// reply, the assignee's alert — and when that ran to about five seconds,
// Periskope stopped waiting and sent the message again. One WhatsApp message
// became two identical tasks, two acknowledgements to the client, and two
// alerts to the assignee, five seconds apart. Caught by testing against the
// live system; it would have reached a client eventually.
//
// Deliberately in memory rather than a table. Redeliveries arrive seconds
// after the original, so they land in the same process almost every time,
// and the alternative is a database write on every inbound message plus a
// migration to a schema the client is wary of. A redelivery that straddles a
// restart still slips through — accepted, because the cost is one duplicate
// task in a rare case, and the fix for that is making the webhook answer
// faster, not storing more.

const TTL_MS = 10 * 60 * 1000;
// Enough for any plausible burst; the oldest are dropped first. A cap matters
// because this is a long-lived process and an unbounded map is a slow leak.
const MAX_ENTRIES = 1000;

const seen = new Map<string, number>();

function prune(now: number): void {
  for (const [key, at] of seen) {
    if (now - at > TTL_MS) seen.delete(key);
  }
  // Map iterates in insertion order, so the front is the oldest.
  while (seen.size > MAX_ENTRIES) {
    const oldest = seen.keys().next();
    if (oldest.done) break;
    seen.delete(oldest.value);
  }
}

// True the first time a message is offered, false every time after. The
// caller should ignore anything that comes back false.
export function markMessageSeen(key: string, now: number = Date.now()): boolean {
  prune(now);
  if (seen.has(key)) return false;
  seen.set(key, now);
  return true;
}

// What identifies "the same message". Periskope's own message id is used when
// it's there, since a redelivery carries the same one. The fallback matters
// as much: if that field is ever renamed or missing, chat + sender + exact
// text still catches a redelivery, because two genuinely separate requests
// with byte-identical text seconds apart in the same chat is not a thing
// people do — and if they did, dropping the second is the kinder mistake.
export function messageKey(payload: any, chatId: string, text: string, senderPhone?: string): string {
  const id = payload?.data?.message_id ?? payload?.data?.id ?? payload?.id;
  return typeof id === "string" && id ? `id:${id}` : `msg:${chatId}|${senderPhone ?? ""}|${text}`;
}

// Test seam only.
export function resetSeenMessages(): void {
  seen.clear();
}
