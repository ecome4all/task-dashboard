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

  create(input: {
    taskId: string;
    authorId: string;
    authorName: string;
    body: string;
    sendToClient?: boolean;
  }) {
    return prisma.taskNote.create({ data: { ...input, tenantId: TENANT_ID } });
  },

  findById(id: string) {
    return prisma.taskNote.findFirst({ where: { id, tenantId: TENANT_ID } });
  },

  // Notes on this task that are meant for the client and haven't gone yet —
  // what the next update message carries along with it. Oldest first, so they
  // read in the order they were written.
  listPendingForClient(taskId: string) {
    return prisma.taskNote.findMany({
      where: { tenantId: TENANT_ID, taskId, sendToClient: true, sentAt: null },
      orderBy: { createdAt: "asc" },
    });
  },

  // Same question for the whole board at once: which tasks have a note
  // waiting to go. The Send button turns on for these even when no field has
  // changed, since otherwise a note on a task nobody edits again could never
  // reach the client.
  async taskIdsWithPendingNotes(): Promise<Set<string>> {
    const rows = await prisma.taskNote.groupBy({
      by: ["taskId"],
      where: { tenantId: TENANT_ID, sendToClient: true, sentAt: null },
    });
    return new Set(rows.map((row) => row.taskId));
  },

  // Marked only after the message carrying them actually went. A failed send
  // leaves them pending, so they ride along with the next attempt rather than
  // being quietly dropped.
  markManySent(ids: string[]) {
    return prisma.taskNote.updateMany({
      where: { id: { in: ids } },
      data: { sentAt: new Date() },
    });
  },

  markSent(id: string) {
    return prisma.taskNote.update({ where: { id }, data: { sentAt: new Date() } });
  },

  delete(id: string) {
    return prisma.taskNote.delete({ where: { id } });
  },
};
