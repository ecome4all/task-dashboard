import { prisma } from "../db";

const TENANT_ID = "default";

// Excludes passwordHash — list()/create() results go straight into API
// responses, and a bcrypt hash has no business leaving the server even
// though it's not plaintext.
const PUBLIC_FIELDS = { id: true, name: true, email: true, role: true, active: true } as const;

export const employeeRepository = {
  list() {
    return prisma.employee.findMany({
      where: { tenantId: TENANT_ID, active: true },
      orderBy: { name: "asc" },
      select: PUBLIC_FIELDS,
    });
  },

  // Includes inactive employees — only the admin employee-management panel
  // needs those (to reactivate someone), so this stays separate from list().
  listAll() {
    return prisma.employee.findMany({
      where: { tenantId: TENANT_ID },
      orderBy: { name: "asc" },
      select: PUBLIC_FIELDS,
    });
  },

  create(name: string) {
    return prisma.employee.create({
      data: { name, tenantId: TENANT_ID },
      select: PUBLIC_FIELDS,
    });
  },

  updateRoleAndActive(id: string, changes: { role?: string; active?: boolean }) {
    return prisma.employee.update({
      where: { id },
      data: changes,
      select: PUBLIC_FIELDS,
    });
  },

  findByEmail(email: string) {
    return prisma.employee.findUnique({ where: { email } });
  },

  findById(id: string) {
    return prisma.employee.findFirst({ where: { id, tenantId: TENANT_ID } });
  },
};
