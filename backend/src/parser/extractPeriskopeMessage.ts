export interface IncomingMessage {
  chatId: string;
  text: string;
  senderPhone?: string;
}

// Periskope's actual webhook wrapper is { data, event_type, id, org_id,
// previous_attributes } — every doc example on their site shows "event", but
// real traffic confirmed "event_type" is the real field name. Only
// "message.created" is a new inbound message — everything else (e.g.
// message.ack.updated, delivery/read receipts) is ignored here.
//
// `from_me` is deliberately NOT filtered. It used to be, to stop our own
// outgoing sends echoing back through the same webhook — but that also
// silently dropped `task:` messages typed by Ecom4all's own staff from the
// connected number, which is a normal way to log work. Anyone in a linked
// group should be able to raise a task, whoever they are.
//
// This is safe because the `task:` prefix is the real gate, and nothing this
// app sends starts with it — not the "✅ Got it, logged." acknowledgement,
// and not the status-update messages (they open with the quoted task
// description). Covered by a test, since a message of ours that did parse as
// a task would loop: task -> ack -> task -> ...
export function extractPeriskopeMessage(payload: any): IncomingMessage | null {
  if (payload?.event_type !== "message.created") return null;

  const data = payload?.data;
  if (!data) return null;
  // Confirmed against real traffic: Periskope uses "chat" for a plain text
  // message (not "text") — other values seen include "ptt" (voice note) and
  // presumably "image"/etc. for media.
  if (data.message_type && data.message_type !== "chat") return null;

  const chatId = data.chat_id;
  const text = data.body;
  // In a group, chat_id is the group's own JID, not the sender's — the
  // individual who actually posted is sender_phone (author is null in real
  // traffic, sender_phone is reliably populated for both group and 1:1).
  // Undefined for 1:1 chats, where chatId already IS the sender's number.
  const senderPhone = data.sender_phone ?? undefined;

  if (!chatId || typeof text !== "string") return null;
  return { chatId, text, ...(senderPhone ? { senderPhone } : {}) };
}
