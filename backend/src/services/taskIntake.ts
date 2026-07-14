import { parseTaskMessage } from "../parser/taskParser";
import { taskRepository } from "../repositories/taskRepository";
import { WhatsAppAdapter } from "../whatsapp/whatsappAdapter";

export interface TaskIntakeParams {
  source: string;
  chatId: string;
  text: string;
  whatsapp: WhatsAppAdapter;
}

// Shared by every intake channel (whapi group, official 1:1): parse the
// task: prefix, store it, and acknowledge on the same channel it arrived on.
// Returns null when the message wasn't a task (no prefix) so callers can
// distinguish "ignored" from "created" without duplicating the parse logic.
export async function handleIncomingTaskMessage(params: TaskIntakeParams) {
  const parsed = parseTaskMessage(params.text);
  if (!parsed) return null;

  const task = await taskRepository.create({
    source: params.source,
    sourceRef: params.chatId,
    description: parsed.description,
  });

  await params.whatsapp.sendMessage(params.chatId, "✅ Got it, logged.");

  return task;
}
