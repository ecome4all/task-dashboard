import { WhatsAppAdapter } from "./whatsappAdapter";

const PERISKOPE_BASE_URL = "https://api.periskope.app";

// Group and 1:1 chat IDs use the same "<id>@g.us" / "<number>@c.us" JIDs as
// whapi.cloud, so callers (resolveAdapterForSource, task.sourceRef) don't
// need to know which provider is actually behind this adapter.
export class PeriskopeAdapter implements WhatsAppAdapter {
  constructor(
    private readonly apiKey: string,
    private readonly phone: string
  ) {}

  async sendMessage(to: string, text: string): Promise<void> {
    if (!this.apiKey) {
      console.warn("[PeriskopeAdapter] PERISKOPE_API_KEY not set — skipping send:", { to, text });
      return;
    }

    const response = await fetch(`${PERISKOPE_BASE_URL}/v1/message/send`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "x-phone": this.phone,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ chat_id: to, message: text }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Periskope send failed (${response.status}): ${errorBody}`);
    }
  }

  // The incoming webhook payload's `data` is a *message*, and (confirmed
  // against real traffic) a message never carries the chat's display name —
  // only the Chats endpoint does. So capturing a group's name at task-intake
  // time means a second API call here, not just reading a field off the
  // webhook body like the docs' examples imply.
  async getChatName(chatId: string): Promise<string | undefined> {
    if (!this.apiKey) return undefined;
    try {
      const response = await fetch(
        `${PERISKOPE_BASE_URL}/v1/chats?chat_id=${encodeURIComponent(chatId)}`,
        { headers: { Authorization: `Bearer ${this.apiKey}`, "x-phone": this.phone } }
      );
      if (!response.ok) return undefined;
      const body = (await response.json()) as any;
      return body?.chats?.[0]?.chat_name ?? undefined;
    } catch (err) {
      console.error("Failed to fetch Periskope chat name:", err);
      return undefined;
    }
  }
}
