import { Router } from "express";
import { parseTaskMessage } from "../parser/taskParser";
import { extractIncomingMessage } from "../parser/extractIncomingMessage";
import { taskRepository } from "../repositories/taskRepository";
import { WhatsAppAdapter } from "../whatsapp/whatsappAdapter";

export function createWebhookRouter(whatsapp: WhatsAppAdapter) {
  const router = Router();

  router.post("/whapi", async (req, res) => {
    // whapi.cloud has no built-in request-signing scheme, so the webhook URL
    // registered in its dashboard should include ?secret=<WEBHOOK_SHARED_SECRET>
    // — this is the only thing stopping an arbitrary internet POST from
    // creating fake tasks, since this endpoint can't sit behind session auth.
    const expectedSecret = process.env.WEBHOOK_SHARED_SECRET;
    if (expectedSecret && req.query.secret !== expectedSecret) {
      res.status(401).send("unauthorized");
      return;
    }

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
