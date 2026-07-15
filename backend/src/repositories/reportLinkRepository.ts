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

  markSent(id: string) {
    return prisma.reportLink.update({
      where: { id },
      data: { lastSentAt: new Date() },
    });
  },
};
