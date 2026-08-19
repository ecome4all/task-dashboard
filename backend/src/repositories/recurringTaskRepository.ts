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

  // Takes a due repeat *before* its task is made, and says whether it got it.
  // Guarded on the nextRunAt that was read a moment ago, so if two passes are
  // ever in flight over the same repeat — a tick that ran long and overlapped
  // the next one, or a second copy of the backend — only the first one to
  // write matches the row. The other is told no, and creates nothing.
  //
  // Claiming first is the opposite of what this did before, when the task was
  // created and the clock moved afterwards. That order retried a failed run on
  // the next tick, which is the nicer failure; but its other half was creating
  // the same task twice, which reaches whoever it lands on. releaseClaim below
  // keeps the retry without the duplicate.
  async claim(id: string, expectedNextRunAt: Date, ranAt: Date, nextRunAt: Date): Promise<boolean> {
    const { count } = await prisma.recurringTask.updateMany({
      where: { id, tenantId: TENANT_ID, nextRunAt: expectedNextRunAt },
      data: { lastRunAt: ranAt, nextRunAt },
    });
    return count === 1;
  },

  // Puts the clock back when the task a claim was taken for could not be
  // created, so the next tick tries that run again rather than skipping it.
  //
  // lastTaskId is deliberately left alone: it points at the task from the run
  // *before* this one, which is still the right answer while this run is being
  // retried — the failed run created nothing to point at.
  releaseClaim(id: string, nextRunAt: Date, lastRunAt: Date | null) {
    return prisma.recurringTask.update({ where: { id }, data: { nextRunAt, lastRunAt } });
  },

  // Remembers the task this repeat just made, so the next turn can see
  // whether it was ever finished before making another — see
  // taskRepository.openTaskFor. Written after the task exists rather than in
  // the same breath as the claim, because a claim that goes on to fail must
  // not leave this pointing at a task that was never created.
  recordTask(id: string, taskId: string) {
    return prisma.recurringTask.update({ where: { id }, data: { lastTaskId: taskId } });
  },
};
