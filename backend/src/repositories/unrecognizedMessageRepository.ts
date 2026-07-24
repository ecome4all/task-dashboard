import { prisma } from "../db";

const TENANT_ID = "default";

export interface CreateUnrecognizedMessageInput {
  source: string;
  sourceRef: string;
  text: string;
  chatName?: string;
}

export const unrecognizedMessageRepository = {
  create(input: CreateUnrecognizedMessageInput) {
    return prisma.unrecognizedMessage.create({
      data: { ...input, tenantId: TENANT_ID },
    });
  },

  // Raw rows, newest first, for the caller to reduce down to one entry per
  // chat_id (first occurrence = most recently seen) and filter against
  // clients already linked — see clients.ts's /unrecognized route.
  listSources() {
    return prisma.unrecognizedMessage.findMany({
      where: { tenantId: TENANT_ID },
      select: { sourceRef: true, chatName: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });
  },

  // "Ignore" on the Unrecognized Senders screen — clears this sender's
  // logged messages so they drop off the list without being linked to a
  // client. Not a permanent block: if this chat_id sends another task:
  // message later, taskIntake logs it again and it reappears here.
  deleteBySourceRef(sourceRef: string) {
    return prisma.unrecognizedMessage.deleteMany({
      where: { tenantId: TENANT_ID, sourceRef },
    });
  },
};
