import { SessionEmployee } from "../auth/requireAuth";

// Who is allowed to see which task on the board.
//
// A member sees only the work that is theirs: tasks assigned to them, plus
// tasks nobody has been put on yet (which anyone can pick up). Everything
// assigned to someone else — a manager's or an admin's work in particular —
// stays out of their view entirely. Admins and managers go on seeing all of
// it, since triage means looking at everyone's board.
//
// Turned on the *viewer's* role rather than the assignee's. Written the other
// way round ("hide tasks whose assignee is a manager") every request would
// have to re-read the role behind every assignee name to answer the same
// question, and a member's own work would still be filtered by whoever else
// happened to hold that name.
export interface TaskVisibility {
  // Only tasks assigned to this name, or to nobody at all.
  ownName: string;
}

// Null means "no limit" — see everything. Anything other than a known
// admin/manager gets the restricted view, so a missing or unexpected role
// fails closed rather than exposing the whole board.
export function taskVisibilityFor(employee: SessionEmployee | undefined | null): TaskVisibility | null {
  if (employee && (employee.role === "admin" || employee.role === "manager")) return null;
  return { ownName: employee?.name ?? "" };
}

// The single-task counterpart of the list filter, for routes that reach a
// task by id (notes, editing, sending). Without this, a member who can't see
// a task on the board could still read and change it by its id.
export function isTaskVisible(
  task: { assignee: string | null },
  visibility: TaskVisibility | null
): boolean {
  if (!visibility) return true;
  return task.assignee === null || task.assignee === visibility.ownName;
}
