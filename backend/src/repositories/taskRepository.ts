import { prisma } from "../db";
import { TaskVisibility } from "../services/taskVisibility";
import { DUPLICATE_WINDOW_MS, pickDuplicate } from "../services/duplicateTasks";

const TENANT_ID = "default";

export interface CreateTaskInput {
  source: string;
  sourceRef: string;
  description: string;
  chatName?: string;
  clientName?: string;
  // Never set by WhatsApp intake — nothing is auto-triaged there. Present
  // for repeating tasks (see scheduler.ts), which copy the triage off the
  // task they were created from, so a repeat doesn't come back stripped of
  // the employee and type someone already picked, and for a task raised by
  // hand on the board, where all of it is filled in on the form.
  assignee?: string | null;
  taskType?: string | null;
  marketplace?: string | null;
  // Only ever set by the "New task" form (admins and managers), never by
  // intake — the same two roles that can set a due date on an existing task.
  dueDate?: Date | null;
}

// A member's board is limited to their own work — see services/taskVisibility.
// Null means no limit, which is every other role.
function visibilityWhere(visibility: TaskVisibility | null) {
  if (!visibility) return {};
  return { OR: [{ assignee: visibility.ownName }, { assignee: null }] };
}

export type TaskStatus =
  | "no_action_yet"
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

  // The task this one would be a second copy of, or null. Narrowed in the
  // query to the same chat inside the window, which is a handful of rows at
  // most; the wording itself is compared in JS so the match doesn't depend on
  // the database's collation — see services/duplicateTasks.
  //
  // Called before creating, never inside create(), so each of the three places
  // a task is made can do the right thing with the answer. They differ: intake
  // must not send the client a second acknowledgement, the scheduler must not
  // alert the assignee again, and the board should show the person the task
  // they already made rather than an error.
  async findDuplicateOf(input: { description: string; sourceRef: string }, now: Date) {
    const candidates = await prisma.task.findMany({
      where: {
        tenantId: TENANT_ID,
        sourceRef: input.sourceRef,
        createdAt: { gte: new Date(now.getTime() - DUPLICATE_WINDOW_MS) },
      },
      orderBy: { createdAt: "desc" },
    });
    return pickDuplicate(input, candidates);
  },

  // Filtered in the query rather than after it: a member's own board is
  // usually a small slice of everything, and the tasks they can't see must
  // never leave the database in the first place.
  list(visibility: TaskVisibility | null = null) {
    return prisma.task.findMany({
      where: { tenantId: TENANT_ID, ...visibilityWhere(visibility) },
      orderBy: { createdAt: "desc" },
    });
  },

  findById(id: string) {
    return prisma.task.findFirst({ where: { id, tenantId: TENANT_ID } });
  },

  // Every task belonging to one client, for the Client Details screen.
  // A Task has no clientId — it stores the client's *name* as it was at
  // intake time (see taskIntake.ts), so a name match alone would silently
  // drop every older task the moment a client gets renamed. The chat a task
  // arrived in is the stable link, so this also matches any of the client's
  // linked WhatsApp groups, plus their saved phone for 1:1 tasks (compared
  // on the last 10 digits, since sourceRef carries a provider suffix like
  // "@c.us" and may or may not include the country code — same normalizing
  // rule as clientRepository.findByChatId).
  listForClient(params: { name: string; groupIds: string[]; phone: string | null }) {
    const phoneDigits = params.phone ? params.phone.replace(/\D/g, "").slice(-10) : "";
    return prisma.task.findMany({
      where: {
        tenantId: TENANT_ID,
        OR: [
          { clientName: params.name },
          ...(params.groupIds.length > 0 ? [{ sourceRef: { in: params.groupIds } }] : []),
          ...(phoneDigits.length === 10 ? [{ sourceRef: { contains: phoneDigits } }] : []),
        ],
      },
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

  // Overwrites the "what's already been told to the client" snapshot the
  // Send button diffs against — used both after a manual send (the full
  // current snapshot) and after an automatic status-change notification
  // (just that one field merged in, so a later manual send doesn't restate
  // something already announced).
  updateSnapshot(id: string, snapshot: Record<string, string | null>) {
    return prisma.task.update({ where: { id }, data: { sentSnapshot: snapshot } });
  },

  // Hard delete, for a duplicate, a test, or a message that should never have
  // become a task at all. Its notes go with it — TaskNote cascades on the
  // relation — so nothing is left pointing at a task that no longer exists.
  //
  // Marking something done is the normal way to finish work; this is for
  // things that were never work in the first place.
  delete(id: string) {
    return prisma.task.delete({ where: { id } });
  },
};
