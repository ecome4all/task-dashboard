export interface IncomingMessage {
  chatId: string;
  text: string;
  chatName?: string;
  senderPhone?: string;
}

// Periskope's actual webhook wrapper is { data, event_type, id, org_id,
// previous_attributes } — every doc example on their site shows "event", but
// real traffic confirmed "event_type" is the real field name. Only
// "message.created" is a new inbound message — everything else (e.g.
// message.ack.updated, delivery/read receipts) is ignored here. `from_me`
// filters out our own outgoing sends echoing back through the same webhook.
export function extractPeriskopeMessage(payload: any): IncomingMessage | null {
  if (payload?.event_type !== "message.created") return null;

  const data = payload?.data;
  if (!data || data.from_me) return null;
  // Confirmed against real traffic: Periskope uses "chat" for a plain text
  // message (not "text") — other values seen include "ptt" (voice note) and
  // presumably "image"/etc. for media.
  if (data.message_type && data.message_type !== "chat") return null;

  const chatId = data.chat_id;
  const text = data.body;
  const chatName = data.chat_name ?? undefined;
  // In a group, chat_id is the group's own JID, not the sender's — the
  // individual who actually posted is sender_phone (author is null in real
  // traffic, sender_phone is reliably populated for both group and 1:1).
  // Undefined for 1:1 chats, where chatId already IS the sender's number.
  const senderPhone = data.sender_phone ?? undefined;

  if (!chatId || typeof text !== "string") return null;
  return { chatId, text, ...(chatName ? { chatName } : {}), ...(senderPhone ? { senderPhone } : {}) };
}
