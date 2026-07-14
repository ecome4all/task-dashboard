import { Router } from "express";
import { parseTaskMessage } from "../parser/taskParser";
import { extractIncomingMessage } from "../parser/extractIncomingMessage";
import { taskRepository } from "../repositories/taskRepository";
import { WhatsAppAdapter } from "../whatsapp/whatsappAdapter";

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
