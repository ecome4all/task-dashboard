export interface WhatsAppAdapter {
  sendMessage(to: string, text: string): Promise<void>;
}
