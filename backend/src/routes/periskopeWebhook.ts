import { Router } from "express";
import crypto from "crypto";
import { extractPeriskopeMessage } from "../parser/extractPeriskopeMessage";
import { handleIncomingTaskMessage } from "../services/taskIntake";
import { markMessageSeen, messageKey } from "../services/seenMessages";
import { WhatsAppChannels } from "../whatsapp/resolveAdapter";

// Periskope signs every webhook POST with an HMAC-SHA256 of the raw request
// body, sent in the x-periskope-signature header — verified against the
// signing key from Settings > Webhooks (PERISKOPE_WEBHOOK_SECRET). This is
// the only thing stopping an arbitrary internet POST from creating fake
// tasks, since this endpoint can't sit behind session auth.
export function isValidSignature(rawBody: Buffer | undefined, signature: string | undefined, secret: string): boolean {
  if (!rawBody || !signature) return false;

  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const expectedBuf = Buffer.from(expected, "utf8");
  const signatureBuf = Buffer.from(signature, "utf8");

  return expectedBuf.length === signatureBuf.length && crypto.timingSafeEqual(expectedBuf, signatureBuf);
}

export function createPeriskopeWebhookRouter(channels: WhatsAppChannels) {
  const router = Router();

  router.post("/periskope", async (req, res) => {
    const secret = process.env.PERISKOPE_WEBHOOK_SECRET;
    if (secret && !isValidSignature((req as any).rawBody, req.get("x-periskope-signature"), secret)) {
      res.status(401).send("unauthorized");
      return;
    }

    console.log("[periskope webhook] raw payload:", JSON.stringify(req.body));

    const incoming = extractPeriskopeMessage(req.body);
    if (!incoming) {
      res.status(200).send("ignored: not a new text message");
      return;
    }

    // Periskope redelivers a message it didn't get a quick enough answer
    // about, and everything below this line is slow: another Periskope call
    // for the chat name, the task write, the reply to the group, the
    // assignee's alert. When that reached about five seconds, one message
    // became two identical tasks, two "Got it, logged" replies to the client
    // and two alerts to the assignee.
    //
    // The gate goes here rather than deeper in, because the duplicate work
    // starts on the very next line. Answering 200 is right: the message was
    // handled, the first time we saw it.
    if (!markMessageSeen(messageKey(req.body, incoming.chatId, incoming.text, incoming.senderPhone))) {
      console.log("[periskope webhook] ignoring a message already handled:", incoming.chatId);
      res.status(200).send("ignored: already handled");
      return;
    }

    // The webhook payload's `data` is a message, not a chat — it never
    // carries the chat's display name, so this is a second API call.
    const chatName = await channels.whapi.getChatName?.(incoming.chatId);

    const task = await handleIncomingTaskMessage({
      source: "whatsapp_group",
      chatId: incoming.chatId,
      text: incoming.text,
      chatName,
      senderPhone: incoming.senderPhone,
      channels,
    });

    if (!task) {
      res.status(200).send("ignored: no task: prefix");
      return;
    }

    res.status(200).json({ taskId: task.id });
  });

  return router;
}
