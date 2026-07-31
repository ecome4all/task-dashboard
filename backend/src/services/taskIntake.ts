import { parseTaskMessage } from "../parser/taskParser";
import { taskRepository } from "../repositories/taskRepository";
import { clientRepository } from "../repositories/clientRepository";
import { unrecognizedMessageRepository } from "../repositories/unrecognizedMessageRepository";
import { WhatsAppAdapter } from "../whatsapp/whatsappAdapter";

export interface TaskIntakeParams {
  source: string;
  chatId: string;
  text: string;
  whatsapp: WhatsAppAdapter;
  chatName?: string;
  senderPhone?: string;
}

// WhatsApp JIDs: a group is "<digits>-<digits>@g.us" or "<digits>@g.us",
// anything else ("<number>@c.us", or a bare number on the official channel)
// is a 1:1 chat, where there's no group to link in the first place.
function isGroupChat(chatId: string): boolean {
  return chatId.endsWith("@g.us");
}

// Shared by every intake channel (whapi group, official 1:1, Periskope): parse
// the task: prefix, gate on a known client, store it, and acknowledge on the
// same channel it arrived on. Returns null when the message wasn't a task (no
// prefix) OR the sender isn't a recognized client yet, so callers can log
// "ignored" without duplicating either check.
//
// The gate: only a chat_id (or, in a group, the individual sender's phone)
// already tied to an active Client becomes a real task — see
// clientRepository.findByChatId. An unrecognized sender's message is logged
// to UnrecognizedMessage instead — visible on the Clients tab for staff to
// review and link — and gets no WhatsApp reply, since nothing was actually
// logged for them yet.
export async function handleIncomingTaskMessage(params: TaskIntakeParams) {
  const parsed = parseTaskMessage(params.text);
  if (!parsed) return null;

  const client = await clientRepository.findByChatId(params.chatId, params.senderPhone);
  if (!client) {
    await unrecognizedMessageRepository.create({
      source: params.source,
      sourceRef: params.chatId,
      text: parsed.description,
      chatName: params.chatName,
    });
    return null;
  }

  // The client was recognized, but possibly only from the *sender's* own
  // phone (findByChatId check #3) — in which case the group itself has never
  // been linked, and the next task from anyone else in it (the client's
  // staff, a colleague) wouldn't be recognized at all. Saving the link the
  // first time the client's own number posts makes the whole group work from
  // then on, with nobody having to find and copy a raw group JID by hand.
  //
  // Best-effort, and last-write-loses-to-the-existing-link by design (see
  // ensureGroupLinked): the task itself is what matters, so a failure here
  // is logged and swallowed rather than dropping a real task on the floor.
  if (isGroupChat(params.chatId)) {
    try {
      const linked = await clientRepository.ensureGroupLinked(
        client.id,
        params.chatId,
        params.chatName ?? null
      );
      if (linked) {
        console.log(
          `[task intake] auto-linked group ${params.chatId} to client ${client.name} ` +
            `(recognized from sender ${params.senderPhone ?? "unknown"})`
        );
      }
    } catch (err) {
      console.error("Failed to auto-link WhatsApp group to client:", err);
    }
  }

  const task = await taskRepository.create({
    source: params.source,
    sourceRef: params.chatId,
    description: parsed.description,
    chatName: params.chatName,
    clientName: client.name,
  });

  // Best-effort: the task is already saved above, and this ack is just a
  // courtesy — a failed send (network blip, bad chat_id, provider outage)
  // must not crash the webhook handler, since an uncaught rejection here
  // would take down the whole server, not just this one message.
  try {
    await params.whatsapp.sendMessage(params.chatId, "✅ Got it, logged.");
  } catch (err) {
    console.error("Failed to send task acknowledgement:", err);
  }

  return task;
}
