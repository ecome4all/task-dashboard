import { Router } from "express";
import { extractOfficialMessage } from "../parser/extractOfficialMessage";
import { handleIncomingTaskMessage } from "../services/taskIntake";
import { WhatsAppAdapter } from "../whatsapp/whatsappAdapter";

export function createOfficialWebhookRouter(whatsapp: WhatsAppAdapter) {
  const router = Router();

  // Meta calls this once, when the webhook URL is registered in the App
  // Dashboard, to prove you control the endpoint.
  router.get("/official", (req, res) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
      res.status(200).send(challenge);
      return;
    }

    res.status(403).send("verification failed");
  });

  router.post("/official", async (req, res) => {
    console.log("[official webhook] raw payload:", JSON.stringify(req.body));

    const incoming = extractOfficialMessage(req.body);
    if (!incoming) {
      // Normal for delivery/read-status webhooks, not just malformed messages.
      res.status(200).send("ignored: no message in payload");
      return;
    }

    const task = await handleIncomingTaskMessage({
      source: "whatsapp_official",
      chatId: incoming.chatId,
      text: incoming.text,
      whatsapp,
    });

    if (!task) {
      res.status(200).send("ignored: no task: prefix");
      return;
    }

    res.status(200).json({ taskId: task.id });
  });

  return router;
}
