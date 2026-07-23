import { prisma } from "../db";

const TENANT_ID = "default";

// value is derived once from the label at creation time and never changes,
// even if the label is later renamed — it's what's actually stored on Task
// rows, so changing it after the fact would orphan existing tasks' values.
function slugify(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export const configOptionRepository = {
  // Active options only, in display order — what every dropdown reads.
  list(category: string) {
    return prisma.configOption.findMany({
      where: { tenantId: TENANT_ID, category, active: true },
      orderBy: { sortOrder: "asc" },
    });
  },

  // Includes inactive options — only the Settings management view needs
  // those (to reactivate one), so this stays separate from list().
  listAll(category: string) {
    return prisma.configOption.findMany({
      where: { tenantId: TENANT_ID, category },
      orderBy: { sortOrder: "asc" },
    });
  },

  async create(category: string, label: string) {
    const value = slugify(label);
    const existingCount = await prisma.configOption.count({ where: { tenantId: TENANT_ID, category } });
    return prisma.configOption.create({
      data: { tenantId: TENANT_ID, category, value, label, sortOrder: existingCount },
    });
  },

  update(id: string, changes: { label?: string; active?: boolean }) {
    return prisma.configOption.update({ where: { id }, data: changes });
  },
};
