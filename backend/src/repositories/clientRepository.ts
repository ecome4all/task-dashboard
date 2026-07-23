import { prisma } from "../db";

const TENANT_ID = "default";

const PUBLIC_FIELDS = {
  id: true,
  name: true,
  phone: true,
  whatsappGroupId: true,
  whatsappGroupName: true,
  notes: true,
  active: true,
} as const;

// Staff type a bare 10-digit Indian mobile number most of the time — this
// adds the "91" country code so it actually matches the full chat_id format
// WhatsApp providers use ("91XXXXXXXXXX@c.us"), both for the sender-gate
// lookup below and for outbound sends (Send Update / Report Links use
// `phone` directly as the send target). Numbers that already carry a country
// code (or any other digit count) are left untouched, not double-prefixed.
function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.length === 10 ? `91${digits}` : digits;
}

export const clientRepository = {
  list() {
    return prisma.client.findMany({
      where: { tenantId: TENANT_ID, active: true },
      orderBy: { name: "asc" },
      select: PUBLIC_FIELDS,
    });
  },

  // Includes inactive clients — only the management panel needs those
  // (to reactivate one), so this stays separate from list().
  listAll() {
    return prisma.client.findMany({
      where: { tenantId: TENANT_ID },
      orderBy: { name: "asc" },
      select: PUBLIC_FIELDS,
    });
  },

  create(data: { name: string; phone?: string; notes?: string }) {
    return prisma.client.create({
      data: { ...data, phone: data.phone ? normalizePhone(data.phone) : data.phone, tenantId: TENANT_ID },
      select: PUBLIC_FIELDS,
    });
  },

  update(
    id: string,
    changes: {
      name?: string;
      phone?: string;
      whatsappGroupId?: string | null;
      whatsappGroupName?: string | null;
      notes?: string;
      active?: boolean;
    }
  ) {
    return prisma.client.update({
      where: { id },
      data: { ...changes, phone: changes.phone ? normalizePhone(changes.phone) : changes.phone },
      select: PUBLIC_FIELDS,
    });
  },

  // Hard delete, unlike the active/inactive toggle above — nothing else
  // references a Client by foreign key (Task.clientName is just a text
  // snapshot taken at intake time, not a relation), so this is a clean
  // delete with no orphaned rows to worry about elsewhere.
  delete(id: string) {
    return prisma.client.delete({ where: { id } });
  },

  // Every WhatsApp group chat_id already linked to a client — used to work
  // out which chats seen on incoming messages are still unrecognized.
  linkedGroupIds() {
    return prisma.client
      .findMany({
        where: { tenantId: TENANT_ID, whatsappGroupId: { not: null } },
        select: { whatsappGroupId: true },
      })
      .then((rows) => new Set(rows.map((r) => r.whatsappGroupId as string)));
  },

  // The sender gate for incoming WhatsApp messages: is this message already
  // tied to an active client? Checked three ways, any one is enough:
  //   1. chat_id is their linked group (exact match)
  //   2. chat_id itself is their saved phone (a 1:1 chat — compared by
  //      last-10-digits, so country-code/plus-sign formatting differences
  //      between what staff typed and what the provider sends don't cause a
  //      false negative)
  //   3. senderPhone matches their saved phone — needed for a group chat,
  //      where chat_id is the *group's* JID, not whoever actually posted;
  //      this lets a known client's own number be recognized even in a
  //      group that hasn't been linked yet.
  // Fetches all active clients rather than pushing the digit comparison into
  // SQL — fine at this volume (a handful of clients), and far simpler than
  // raw SQL for a normalize-then-compare match.
  async findByChatId(chatId: string, senderPhone?: string) {
    const clients = await prisma.client.findMany({ where: { tenantId: TENANT_ID, active: true } });
    const chatDigits = chatId.split("@")[0].replace(/\D/g, "").slice(-10);
    const senderDigits = senderPhone ? senderPhone.split("@")[0].replace(/\D/g, "").slice(-10) : undefined;
    return (
      clients.find((c) => {
        if (c.whatsappGroupId === chatId) return true;
        if (!c.phone) return false;
        const phoneDigits = c.phone.replace(/\D/g, "").slice(-10);
        return phoneDigits === chatDigits || (senderDigits !== undefined && phoneDigits === senderDigits);
      }) ?? null
    );
  },
};
