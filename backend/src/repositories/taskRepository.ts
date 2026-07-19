import { prisma } from "../db";

const TENANT_ID = "default";

export interface CreateTaskInput {
  source: string;
  sourceRef: string;
  description: string;
}

export type TaskStatus = "started" | "submitted" | "waiting_for_amazon_client" | "again_submitted" | "done";

export interface UpdateTaskInput {
  assignee?: string;
  taskType?: string;
  marketplace?: string;
  status?: TaskStatus;
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
};
