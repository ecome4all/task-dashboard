import { prisma } from "../db";

const TENANT_ID = "default";

export const employeeRepository = {
  list() {
    return prisma.employee.findMany({
      where: { tenantId: TENANT_ID, active: true },
      orderBy: { name: "asc" },
    });
  },

  create(name: string) {
    return prisma.employee.create({
      data: { name, tenantId: TENANT_ID },
    });
  },

  findByEmail(email: string) {
    return prisma.employee.findUnique({ where: { email } });
  },

  findById(id: string) {
    return prisma.employee.findFirst({ where: { id, tenantId: TENANT_ID } });
  },
};
