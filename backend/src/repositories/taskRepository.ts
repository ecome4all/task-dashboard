import { prisma } from "../db";

const TENANT_ID = "default";

export interface CreateTaskInput {
  source: string;
  sourceRef: string;
  description: string;
  chatName?: string;
  clientName?: string;
}

export type TaskStatus =
  | "started"
  | "submitted"
  | "waiting_for_marketplace"
  | "waiting_for_client"
  | "again_submitted"
  | "done";

export interface UpdateTaskInput {
  assignee?: string;
  taskType?: string;
  marketplace?: string;
  status?: TaskStatus;
  dueDate?: Date | null;
}

export const taskRepository = {
  create(input: CreateTaskInput) {
    return prisma.task.create({
      data: { ...input, tenantId: TENANT_ID },
    });
  },

  list() {
    return prisma.task.findMany({
      where: { tenantId: TENANT_ID },
      orderBy: { createdAt: "desc" },
    });
  },

  findById(id: string) {
    return prisma.task.findFirst({ where: { id, tenantId: TENANT_ID } });
  },

  update(id: string, input: UpdateTaskInput) {
    return prisma.task.update({
      where: { id },
      data: {
        ...input,
        doneAt: input.status === "done" ? new Date() : undefined,
      },
    });
  },

  // Overwrites the "what's already been told to the client" snapshot the
  // Send button diffs against — used both after a manual send (the full
  // current snapshot) and after an automatic status-change notification
  // (just that one field merged in, so a later manual send doesn't restate
  // something already announced).
  updateSnapshot(id: string, snapshot: Record<string, string | null>) {
    return prisma.task.update({ where: { id }, data: { sentSnapshot: snapshot } });
  },
};
