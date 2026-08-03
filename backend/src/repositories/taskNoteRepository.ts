import { prisma } from "../db";

const TENANT_ID = "default";

export const taskNoteRepository = {
  // Oldest first — a note thread reads top to bottom like a conversation,
  // unlike the task list itself, which is newest-first.
  listForTask(taskId: string) {
    return prisma.taskNote.findMany({
      where: { tenantId: TENANT_ID, taskId },
      orderBy: { createdAt: "asc" },
    });
  },

  // How many notes each task has, for the whole board in one query — the
  // task list shows a count per row, and fetching threads per task would be
  // one query per row. The thread itself is only loaded when a row is
  // actually expanded.
  async countsByTask(): Promise<Record<string, number>> {
    const rows = await prisma.taskNote.groupBy({
      by: ["taskId"],
      where: { tenantId: TENANT_ID },
      _count: { _all: true },
    });
    return Object.fromEntries(rows.map((r) => [r.taskId, r._count._all]));
  },

  create(input: { taskId: string; authorId: string; authorName: string; body: string }) {
    return prisma.taskNote.create({ data: { ...input, tenantId: TENANT_ID } });
  },

  findById(id: string) {
    return prisma.taskNote.findFirst({ where: { id, tenantId: TENANT_ID } });
  },

  markSent(id: string) {
    return prisma.taskNote.update({ where: { id }, data: { sentAt: new Date() } });
  },

  delete(id: string) {
    return prisma.taskNote.delete({ where: { id } });
  },
};
