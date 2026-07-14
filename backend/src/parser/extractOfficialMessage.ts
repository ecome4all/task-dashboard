import { IncomingMessage } from "./extractIncomingMessage";

// Meta's Cloud API webhook shape is stable and documented, unlike an
// unofficial provider's — so this is exact, not defensive. A missing
// `messages` array is normal (e.g. delivery-status webhooks) and should be
// ignored quietly, not treated as a parsing failure.
export function extractOfficialMessage(payload: any): IncomingMessage | null {
  const message = payload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (!message) return null;

  const chatId = message.from;
  const text = message.text?.body;
  if (!chatId || typeof text !== "string") return null;

  return { chatId, text };
}
