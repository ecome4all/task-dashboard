export interface IncomingMessage {
  chatId: string;
  text: string;
}

// whapi.cloud's exact webhook shape hasn't been captured against this app yet
// (see ARCHITECTURE_DECISION_GUIDE.md / PROJECT_REPORT_PRICING.md for the prior
// session's findings on other providers' payloads not matching their own docs).
// This extraction is deliberately defensive with fallbacks; log raw payloads
// during the Phase 2 pilot and tighten this once the real shape is confirmed.
export function extractIncomingMessage(payload: any): IncomingMessage | null {
  const message = payload?.messages?.[0] ?? payload;
  const chatId = message?.chat_id ?? message?.from ?? payload?.group_id ?? payload?.phone;
  const text = message?.text?.body ?? message?.body ?? payload?.text;

  if (!chatId || typeof text !== "string") return null;
  return { chatId, text };
}
