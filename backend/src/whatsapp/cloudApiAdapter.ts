import { WhatsAppAdapter } from "./whatsappAdapter";

export class CloudApiAdapter implements WhatsAppAdapter {
  constructor(
    private readonly token: string,
    private readonly phoneNumberId: string,
    private readonly baseUrl: string = "https://graph.facebook.com/v20.0"
  ) {}

  async sendMessage(to: string, text: string): Promise<void> {
    if (!this.token || !this.phoneNumberId) {
      console.warn("[CloudApiAdapter] WhatsApp Cloud API not configured — skipping send:", { to, text });
      return;
    }

    const response = await fetch(`${this.baseUrl}/${this.phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: text },
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`WhatsApp Cloud API send failed (${response.status}): ${errorBody}`);
    }
  }
}
