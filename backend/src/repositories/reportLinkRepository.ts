import { prisma } from "../db";

const TENANT_ID = "default";

export const reportLinkRepository = {
  list() {
    return prisma.reportLink.findMany({
      where: { tenantId: TENANT_ID },
      orderBy: { createdAt: "desc" },
    });
  },

  create(description: string, url: string, createdBy: string) {
    return prisma.reportLink.create({
      data: { description, url, createdBy, tenantId: TENANT_ID },
    });
  },

  findById(id: string) {
    return prisma.reportLink.findFirst({ where: { id, tenantId: TENANT_ID } });
  },

  // Hard delete. Nothing references a ReportLink — it's only ever read to
  // compose a message at send time, and the messages already sent are
  // WhatsApp history, not rows here — so removing one leaves nothing behind.
  delete(id: string) {
    return prisma.reportLink.delete({ where: { id } });
  },

  markSent(id: string) {
    return prisma.reportLink.update({
      where: { id },
      data: { lastSentAt: new Date() },
    });
  },
};
