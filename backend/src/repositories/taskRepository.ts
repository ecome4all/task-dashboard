import { prisma } from "../db";

const TENANT_ID = "default";

export interface CreateTaskInput {
  source: string;
  sourceRef: string;
  description: string;
  chatName?: string;
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

  // Raw rows, newest first, for the caller to reduce down to one entry per
  // group (first occurrence = most recently seen chat_name) and filter
  // against clients already linked — see clients.ts's /unlinked-groups route.
  listGroupSources() {
    return prisma.task.findMany({
      where: { tenantId: TENANT_ID, source: "whatsapp_group" },
      select: { sourceRef: true, chatName: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });
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
