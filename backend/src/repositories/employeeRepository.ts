import { prisma } from "../db";

const TENANT_ID = "default";

// passwordHash is read but never returned — it's only here so the row can
// report *whether* this employee can log in (see toPublic). A bcrypt hash has
// no business leaving the server even though it isn't plaintext, and these
// results go straight into API responses.
const PUBLIC_FIELDS = {
  id: true,
  name: true,
  email: true,
  role: true,
  active: true,
  phone: true,
  passwordHash: true,
} as const;

interface EmployeeRow {
  id: string;
  name: string;
  email: string | null;
  role: string;
  active: boolean;
  phone: string | null;
  passwordHash: string | null;
}

// An employee row is not automatically a login: "Add employee" creates
// somebody who can be given tasks and messaged on WhatsApp, with no way to
// sign in until an admin sets an email and password. Both halves are needed —
// an email with no password can't sign in either — so the screen is told
// hasLogin rather than being left to guess from the email alone.
function toPublic(row: EmployeeRow) {
  const { passwordHash, ...rest } = row;
  return { ...rest, hasLogin: passwordHash !== null };
}

// Stored lower-case so "Shivani@ecom4all.in" and "shivani@ecom4all.in" can't
// become two accounts, and so a login typed with different capitals still
// finds the row (findByEmail is an exact match).
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// Staff type a bare 10-digit Indian mobile number — the same normalizing
// rule Client.phone uses, so a reminder send target is always in the full
// form WhatsApp providers expect. Numbers that already carry a country code
// are left alone rather than double-prefixed.
function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.length === 10 ? `91${digits}` : digits;
}

export const employeeRepository = {
  async list() {
    const rows = await prisma.employee.findMany({
      where: { tenantId: TENANT_ID, active: true },
      orderBy: { name: "asc" },
      select: PUBLIC_FIELDS,
    });
    return rows.map(toPublic);
  },

  // Includes inactive employees — only the admin employee-management panel
  // needs those (to reactivate someone), so this stays separate from list().
  async listAll() {
    const rows = await prisma.employee.findMany({
      where: { tenantId: TENANT_ID },
      orderBy: { name: "asc" },
      select: PUBLIC_FIELDS,
    });
    return rows.map(toPublic);
  },

  async create(name: string) {
    return toPublic(
      await prisma.employee.create({
        data: { name, tenantId: TENANT_ID },
        select: PUBLIC_FIELDS,
      })
    );
  },

  async update(id: string, changes: { role?: string; active?: boolean; phone?: string }) {
    return toPublic(
      await prisma.employee.update({
        where: { id },
        data: {
          ...changes,
          // An empty box means "no number" (so this employee stops getting
          // reminders), not the string "".
          ...(changes.phone !== undefined && { phone: changes.phone.trim() ? normalizePhone(changes.phone) : null }),
        },
        select: PUBLIC_FIELDS,
      })
    );
  },

  // Gives an employee a way to sign in, or replaces the one they have. Set as
  // a pair on purpose: an admin creating a login has to hand over both halves
  // anyway, and there's no password-reset email in this app to fall back on
  // if only one of them were changed.
  async setLogin(id: string, email: string, passwordHash: string) {
    return toPublic(
      await prisma.employee.update({
        where: { id },
        data: { email: normalizeEmail(email), passwordHash },
        select: PUBLIC_FIELDS,
      })
    );
  },

  // Takes away sign-in access while leaving the employee themselves in place —
  // they keep their tasks, their name on the board and their WhatsApp
  // messages. The email is cleared too, so it's free for someone else.
  async clearLogin(id: string) {
    return toPublic(
      await prisma.employee.update({
        where: { id },
        data: { email: null, passwordHash: null },
        select: PUBLIC_FIELDS,
      })
    );
  },

  // Someone changing their own password. Sessions are signed JWTs with no
  // revocation list, so any session already issued stays valid until it
  // expires — worth knowing if a password is ever changed *because* it leaked.
  async setPassword(id: string, passwordHash: string) {
    await prisma.employee.update({ where: { id }, data: { passwordHash } });
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
    return { employee: employee && toPublic(employee), tasksMoved: tasks.count, repeatsMoved: repeats.count };
  },

  // Case doesn't matter to the person typing their email into the login box,
  // so it mustn't matter here either — everything is stored and looked up
  // lower-case (see normalizeEmail).
  findByEmail(email: string) {
    return prisma.employee.findUnique({ where: { email: normalizeEmail(email) } });
  },

  findById(id: string) {
    return prisma.employee.findFirst({ where: { id, tenantId: TENANT_ID } });
  },
};
