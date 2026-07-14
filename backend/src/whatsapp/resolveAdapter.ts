import { WhatsAppAdapter } from "./whatsappAdapter";

export interface WhatsAppChannels {
  whapi: WhatsAppAdapter;
  official: WhatsAppAdapter;
}

// A task must be replied to on the same channel it arrived on — a group
// task can only be answered via whapi.cloud, an official-channel task only
// via the Cloud API. There's no cross-sending between the two.
export function resolveAdapterForSource(source: string, channels: WhatsAppChannels): WhatsAppAdapter {
  return source === "whatsapp_official" ? channels.official : channels.whapi;
}
