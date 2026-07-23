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
}

// Shared by every intake channel (whapi group, official 1:1, Periskope): parse
// the task: prefix, gate on a known client, store it, and acknowledge on the
// same channel it arrived on. Returns null when the message wasn't a task (no
// prefix) OR the sender isn't a recognized client yet, so callers can log
// "ignored" without duplicating either check.
//
// The gate: only a chat_id already tied to an active Client (by linked
// WhatsApp group or saved phone — see clientRepository.findByChatId) becomes
// a real task. An unrecognized sender's message is logged to
// UnrecognizedMessage instead — visible on the Clients tab for staff to
// review and link — and gets no WhatsApp reply, since nothing was actually
// logged for them yet.
export async function handleIncomingTaskMessage(params: TaskIntakeParams) {
  const parsed = parseTaskMessage(params.text);
  if (!parsed) return null;

  const client = await clientRepository.findByChatId(params.chatId);
  if (!client) {
    await unrecognizedMessageRepository.create({
      source: params.source,
      sourceRef: params.chatId,
      text: parsed.description,
      chatName: params.chatName,
    });
    return null;
  }

  const task = await taskRepository.create({
    source: params.source,
    sourceRef: params.chatId,
    description: parsed.description,
    chatName: params.chatName,
  });

  await params.whatsapp.sendMessage(params.chatId, "✅ Got it, logged.");

  return task;
}
