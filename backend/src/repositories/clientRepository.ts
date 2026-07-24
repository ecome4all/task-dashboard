import { prisma } from "../db";

const TENANT_ID = "default";

const PUBLIC_FIELDS = {
  id: true,
  name: true,
  phone: true,
  notes: true,
  active: true,
  whatsappGroups: { select: { id: true, groupId: true, groupName: true } },
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

  update(id: string, changes: { name?: string; phone?: string; notes?: string; active?: boolean }) {
    return prisma.client.update({
      where: { id },
      data: { ...changes, phone: changes.phone ? normalizePhone(changes.phone) : changes.phone },
      select: PUBLIC_FIELDS,
    });
  },

  // Hard delete, unlike the active/inactive toggle above — nothing else
  // references a Client by foreign key except its own ClientWhatsappGroup
  // rows (cascaded via Prisma's onDelete default of Restrict... actually
  // deleted explicitly below), so this is a clean delete with no orphaned
  // rows left over elsewhere.
  async delete(id: string) {
    await prisma.clientWhatsappGroup.deleteMany({ where: { clientId: id } });
    await prisma.client.delete({ where: { id } });
  },

  // Adds one more WhatsApp group to a client's list — a client can have
  // several (e.g. separate groups per region or purpose), unlike phone,
  // which is a single number. Throws (Prisma P2002) if this chat_id is
  // already linked to some client — the caller turns that into a clear
  // "already linked elsewhere" error rather than a silent overwrite.
  addGroup(clientId: string, groupId: string, groupName: string | null) {
    return prisma.clientWhatsappGroup.create({
      data: { tenantId: TENANT_ID, clientId, groupId, groupName },
    });
  },

  removeGroup(groupRowId: string) {
    return prisma.clientWhatsappGroup.delete({ where: { id: groupRowId } });
  },

  // Every WhatsApp group chat_id already linked to a client — used to work
  // out which chats seen on incoming messages are still unrecognized.
  linkedGroupIds() {
    return prisma.clientWhatsappGroup
      .findMany({ where: { tenantId: TENANT_ID }, select: { groupId: true } })
      .then((rows) => new Set(rows.map((r) => r.groupId)));
  },

  // The sender gate for incoming WhatsApp messages: is this message already
  // tied to an active client? Checked three ways, any one is enough:
  //   1. chat_id is one of their linked groups (exact match)
  //   2. chat_id itself is their saved phone (a 1:1 chat — compared by
  //      last-10-digits, so country-code/plus-sign formatting differences
  //      between what staff typed and what the provider sends don't cause a
  //      false negative)
  //   3. senderPhone matches their saved phone — needed for a group chat,
  //      where chat_id is the *group's* JID, not whoever actually posted;
  //      this lets a known client's own number be recognized even in a
  //      group that hasn't been linked yet.
  async findByChatId(chatId: string, senderPhone?: string) {
    const groupMatch = await prisma.clientWhatsappGroup.findFirst({
      where: { tenantId: TENANT_ID, groupId: chatId, client: { active: true } },
      include: { client: true },
    });
    if (groupMatch) return groupMatch.client;

    // Fetches all active clients rather than pushing the digit comparison
    // into SQL — fine at this volume (a handful of clients), and far
    // simpler than raw SQL for a normalize-then-compare match.
    const clients = await prisma.client.findMany({ where: { tenantId: TENANT_ID, active: true } });
    const chatDigits = chatId.split("@")[0].replace(/\D/g, "").slice(-10);
    const senderDigits = senderPhone ? senderPhone.split("@")[0].replace(/\D/g, "").slice(-10) : undefined;
    return (
      clients.find((c) => {
        if (!c.phone) return false;
        const phoneDigits = c.phone.replace(/\D/g, "").slice(-10);
        return phoneDigits === chatDigits || (senderDigits !== undefined && phoneDigits === senderDigits);
      }) ?? null
    );
  },
};
