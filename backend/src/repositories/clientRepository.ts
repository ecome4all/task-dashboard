import { prisma } from "../db";

const TENANT_ID = "default";

const PUBLIC_FIELDS = { id: true, name: true, phone: true, notes: true, active: true } as const;

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
      data: { ...data, tenantId: TENANT_ID },
      select: PUBLIC_FIELDS,
    });
  },

  update(id: string, changes: { name?: string; phone?: string; notes?: string; active?: boolean }) {
    return prisma.client.update({
      where: { id },
      data: changes,
      select: PUBLIC_FIELDS,
    });
  },
};
