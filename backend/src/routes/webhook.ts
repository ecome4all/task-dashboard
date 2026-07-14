import { Router } from "express";
import { parseTaskMessage } from "../parser/taskParser";
import { taskRepository } from "../repositories/taskRepository";
import { WhatsAppAdapter } from "../whatsapp/whatsappAdapter";

interface IncomingMessage {
  chatId: string;
  text: string;
}

// whapi.cloud's exact webhook shape hasn't been captured against this app yet
// (see ARCHITECTURE_DECISION_GUIDE.md / PROJECT_REPORT_PRICING.md for the prior
// session's findings on other providers' payloads not matching their own docs).
// This extraction is deliberately defensive with fallbacks; log raw payloads
// during the Phase 2 pilot and tighten this once the real shape is confirmed.
function extractIncomingMessage(payload: any): IncomingMessage | null {
  const message = payload?.messages?.[0] ?? payload;
  const chatId = message?.chat_id ?? message?.from ?? payload?.group_id ?? payload?.phone;
  const text = message?.text?.body ?? message?.body ?? payload?.text;

  if (!chatId || typeof text !== "string") return null;
  return { chatId, text };
}

export function createWebhookRouter(whatsapp: WhatsAppAdapter) {
  const router = Router();

  router.post("/whapi", async (req, res) => {
    console.log("[webhook] raw payload:", JSON.stringify(req.body));

    const incoming = extractIncomingMessage(req.body);
    if (!incoming) {
      res.status(200).send("ignored: unrecognized payload shape");
      return;
    }

    const parsed = parseTaskMessage(incoming.text);
    if (!parsed) {
      res.status(200).send("ignored: no task: prefix");
      return;
    }

    const task = await taskRepository.create({
      source: "whatsapp_group",
      sourceRef: incoming.chatId,
      description: parsed.description,
    });

    await whatsapp.sendMessage(incoming.chatId, "✅ Got it, logged.");

    res.status(200).json({ taskId: task.id });
  });

  return router;
}
