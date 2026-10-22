import { WhatsAppAdapter } from "./whatsappAdapter";

// Periskope is the only WhatsApp channel: tasks arrive from client groups
// through it, and every reply, assignment notice, reminder and report goes
// out through it. Kept as an object rather than a bare adapter so the many
// callers that take `channels` don't have to change shape if a second
// channel is ever added.
export interface WhatsAppChannels {
  periskope: WhatsAppAdapter;
}
