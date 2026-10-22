export interface WhatsAppAdapter {
  sendMessage(to: string, text: string): Promise<void>;
  // Optional: looks up a chat's display name (a second API call — Periskope's
  // webhook payload itself never carries it).
  getChatName?(chatId: string): Promise<string | undefined>;
}
