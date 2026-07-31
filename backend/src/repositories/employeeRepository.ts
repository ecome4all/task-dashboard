import { prisma } from "../db";

const TENANT_ID = "default";

// Excludes passwordHash — list()/create() results go straight into API
// responses, and a bcrypt hash has no business leaving the server even
// though it's not plaintext.
const PUBLIC_FIELDS = { id: true, name: true, email: true, role: true, active: true, phone: true } as const;

// Staff type a bare 10-digit Indian mobile number — the same normalizing
// rule Client.phone uses, so a reminder send target is always in the full
// form WhatsApp providers expect. Numbers that already carry a country code
// are left alone rather than double-prefixed.
function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.length === 10 ? `91${digits}` : digits;
}

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

  update(id: string, changes: { role?: string; active?: boolean; phone?: string }) {
    return prisma.employee.update({
      where: { id },
      data: {
        ...changes,
        // An empty box means "no number" (so this employee stops getting
        // reminders), not the string "".
        ...(changes.phone !== undefined && { phone: changes.phone.trim() ? normalizePhone(changes.phone) : null }),
      },
      select: PUBLIC_FIELDS,
    });
  },

  // Another employee already using this name. Tasks record an assignee by
  // *name*, not by id, so two employees sharing one name makes it impossible
  // to tell whose work is whose — this is what the rename route checks
  // against before allowing one. Case-insensitive: "test member" and "Test
  // Member" would be just as ambiguous on the board.
  findByName(name: string, excludeId?: string) {
    return prisma.employee.findFirst({
      where: {
        tenantId: TENANT_ID,
        name: { equals: name, mode: "insensitive" },
        ...(excludeId ? { NOT: { id: excludeId } } : {}),
      },
    });
  },

  // Renaming an employee has to move their work with them: Task.assignee and
  // RecurringTask.assignee both hold the name as text, so changing only the
  // Employee row would leave every task they're on pointing at a name that
  // no longer belongs to anybody — it would still display the old name, and
  // would no longer match any option in the assignee dropdown.
  //
  // All three writes go in one transaction: a partial rename is exactly the
  // orphaned state this is here to prevent.
  async rename(id: string, newName: string) {
    const existing = await prisma.employee.findFirst({ where: { id, tenantId: TENANT_ID } });
    if (!existing) return null;

    const [, tasks, repeats] = await prisma.$transaction([
      prisma.employee.update({ where: { id }, data: { name: newName } }),
      prisma.task.updateMany({
        where: { tenantId: TENANT_ID, assignee: existing.name },
        data: { assignee: newName },
      }),
      prisma.recurringTask.updateMany({
        where: { tenantId: TENANT_ID, assignee: existing.name },
        data: { assignee: newName },
      }),
    ]);

    const employee = await prisma.employee.findFirst({ where: { id }, select: PUBLIC_FIELDS });
    return { employee, tasksMoved: tasks.count, repeatsMoved: repeats.count };
  },

  findByEmail(email: string) {
    return prisma.employee.findUnique({ where: { email } });
  },

  findById(id: string) {
    return prisma.employee.findFirst({ where: { id, tenantId: TENANT_ID } });
  },
};
