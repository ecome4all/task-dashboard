export interface WhatsAppAdapter {
  sendMessage(to: string, text: string): Promise<void>;
  // Optional: only Periskope's group channel can look up a chat's display
  // name (a second API call — the webhook payload itself never carries it).
  // The official Cloud API channel has no group concept, so it has nothing
  // to implement this with.
  getChatName?(chatId: string): Promise<string | undefined>;
}
