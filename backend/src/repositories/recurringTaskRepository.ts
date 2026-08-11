import { prisma } from "../db";
import { Frequency } from "../services/recurrence";
import { TaskVisibility } from "../services/taskVisibility";

const TENANT_ID = "default";

export interface CreateRecurringTaskInput {
  source: string;
  sourceRef: string;
  chatName?: string | null;
  description: string;
  clientName?: string | null;
  assignee?: string | null;
  taskType?: string | null;
  marketplace?: string | null;
  frequency: Frequency;
  nextRunAt: Date;
  createdBy: string;
}

export const recurringTaskRepository = {
  // Same rule as the task board: a member sees the repeats that will land on
  // them, plus unassigned ones, and not a manager's. A repeat they can't see
  // would only produce tasks they can't see either.
  list(visibility: TaskVisibility | null = null) {
    return prisma.recurringTask.findMany({
      where: {
        tenantId: TENANT_ID,
        ...(visibility ? { OR: [{ assignee: visibility.ownName }, { assignee: null }] } : {}),
      },
      orderBy: [{ active: "desc" }, { nextRunAt: "asc" }],
    });
  },

  create(input: CreateRecurringTaskInput) {
    return prisma.recurringTask.create({ data: { ...input, tenantId: TENANT_ID } });
  },

  findById(id: string) {
    return prisma.recurringTask.findFirst({ where: { id, tenantId: TENANT_ID } });
  },

  update(id: string, changes: { active?: boolean; frequency?: Frequency; nextRunAt?: Date }) {
    return prisma.recurringTask.update({ where: { id }, data: changes });
  },

  delete(id: string) {
    return prisma.recurringTask.delete({ where: { id } });
  },

  // What the scheduler picks up: active repeats whose turn has come. Ordered
  // oldest-due first so a backlog is worked through in the order it built up.
  due(now: Date) {
    return prisma.recurringTask.findMany({
      where: { tenantId: TENANT_ID, active: true, nextRunAt: { lte: now } },
      orderBy: { nextRunAt: "asc" },
    });
  },

  // Records that a run happened and when the next one is due. Kept as one
  // write so a crash between "task created" and "clock advanced" can't leave
  // a repeat that fires again on the very next scheduler tick.
  markRun(id: string, ranAt: Date, nextRunAt: Date) {
    return prisma.recurringTask.update({
      where: { id },
      data: { lastRunAt: ranAt, nextRunAt },
    });
  },
};
