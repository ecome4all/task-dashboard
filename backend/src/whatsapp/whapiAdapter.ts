import { WhatsAppAdapter } from "./whatsappAdapter";

export class WhapiAdapter implements WhatsAppAdapter {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string
  ) {}

  async sendMessage(to: string, text: string): Promise<void> {
    if (!this.apiKey) {
      console.warn("[WhapiAdapter] WHAPI_API_KEY not set — skipping send:", { to, text });
      return;
    }

    const response = await fetch(`${this.baseUrl}/messages/text`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ to, body: text }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`whapi.cloud send failed (${response.status}): ${errorBody}`);
    }
  }
}
