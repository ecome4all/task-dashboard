import { Router } from "express";
import crypto from "crypto";
import { extractPeriskopeMessage } from "../parser/extractPeriskopeMessage";
import { handleIncomingTaskMessage } from "../services/taskIntake";
import { WhatsAppAdapter } from "../whatsapp/whatsappAdapter";

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

export function createPeriskopeWebhookRouter(whatsapp: WhatsAppAdapter) {
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

    const task = await handleIncomingTaskMessage({
      source: "whatsapp_group",
      chatId: incoming.chatId,
      text: incoming.text,
      chatName: incoming.chatName,
      senderPhone: incoming.senderPhone,
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
