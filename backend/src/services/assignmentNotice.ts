import { employeeRepository } from "../repositories/employeeRepository";
import { WhatsAppChannels } from "../whatsapp/resolveAdapter";
import { formatDate } from "./taskMessages";

export interface AssignedTask {
  description: string;
  clientName: string | null;
  dueDate: Date | null;
}

// The "this is yours now" message an employee gets the moment a task lands on
// them. Short on purpose: it's an alert, not a report — the daily reminder
// (see reminderMessages.ts) is where the full picture of someone's open work
// lives. Client and due date are included because they're what decides
// whether this needs doing right now.
//
// Must never start with "task:" — this goes out on the same connected number
// the group channel uses, and anything we send can come back through the
// webhook. See parser/noLoop.test.ts.
export function composeAssignmentMessage(employeeName: string, task: AssignedTask): string {
  const lines = [`👋 Hi ${employeeName}, a new task is yours:`, "", `*${task.description}*`];
  if (task.clientName) lines.push(`Client: ${task.clientName}`);
  lines.push(`Due: ${formatDate(task.dueDate)}`);
  lines.push("", "— Team Ecom4all");
  return lines.join("\n");
}

// Tells an employee, on WhatsApp, that a task is now theirs. Every caller
// (the dashboard's assignee dropdown, a tag inside an incoming message, a
// repeating task falling due) treats this as best-effort, so this never
// throws and never rejects: the assignment itself is already saved by the
// time it runs, and a WhatsApp failure must not undo it or fail the request.
// Returns whether a message actually went out, for logging.
//
// Skipped without complaint when the employee has no number saved, or the
// assignee name doesn't match an employee at all (a task assigned before
// someone left, say) — same rule as the daily reminder.
export async function notifyAssignee(
  assigneeName: string | null | undefined,
  task: AssignedTask,
  channels: WhatsAppChannels
): Promise<boolean> {
  return messageEmployee(assigneeName, (name) => composeAssignmentMessage(name, task), channels, "assignment");
}

// Sends one employee a WhatsApp message about their work, by name. Shared by
// the assignment alert above and the repeat reminder (see repeatReminder.ts),
// which need the same three things: the employee's saved number, silence when
// there isn't one, and a guarantee of never throwing — every caller has
// already saved whatever it is telling them about, and a WhatsApp failure
// must not undo it or fail the request.
//
// The message is built from a callback rather than passed in, so it can use
// the employee's stored name rather than the assignee string on the task —
// those differ in case and spacing often enough to be worth getting right.
export async function messageEmployee(
  assigneeName: string | null | undefined,
  compose: (employeeName: string) => string,
  channels: WhatsAppChannels,
  logTag: string
): Promise<boolean> {
  if (!assigneeName) return false;

  try {
    const employee = await employeeRepository.findByName(assigneeName);
    if (!employee || !employee.active) {
      console.log(`[${logTag}] no active employee named "${assigneeName}" — nothing sent`);
      return false;
    }
    if (!employee.phone) {
      console.log(`[${logTag}] ${employee.name} has no WhatsApp number saved — nothing sent`);
      return false;
    }

    // Always the group channel's adapter, whichever channel the task itself
    // came in on: it's the one on a real WhatsApp number that can message an
    // arbitrary person. The official Cloud API can only reply inside a
    // 24-hour window the recipient opened, which staff never do. Same
    // reasoning as the daily reminder in scheduler.ts.
    await channels.whapi.sendMessage(employee.phone, compose(employee.name));
    return true;
  } catch (err) {
    console.error(`[${logTag}] failed to message ${assigneeName}:`, err);
    return false;
  }
}
