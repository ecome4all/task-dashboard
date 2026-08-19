import { WhatsAppChannels } from "../whatsapp/resolveAdapter";
import { messageEmployee } from "./assignmentNotice";
import { formatDate } from "./taskMessages";

// What a repeat does when its turn comes round and the last task it made is
// still open: it reminds whoever is holding it, rather than putting a second
// copy of the same work on the board beside the first.
//
// The old behaviour created a new task every time regardless. With thirty
// repeats running that came to roughly twenty-nine tasks a week, several
// landing every morning, and last week's unfinished copy sitting next to this
// week's with nothing to tell them apart. Nobody was asking for the work
// twice — they were asking to be reminded about it.

export interface OpenRepeatTask {
  description: string;
  clientName: string | null;
  status: string;
  dueDate: Date | null;
  createdAt: Date;
}

// Whole days between two dates, floored — how long the task has been sitting
// there. Compared at the start of each day so a task made yesterday evening
// reads as 1 day old this morning, not 0.
export function daysOpen(task: OpenRepeatTask, now: Date): number {
  const startOfDay = (date: Date) => {
    const copy = new Date(date);
    copy.setHours(0, 0, 0, 0);
    return copy;
  };
  const days = Math.floor(
    (startOfDay(now).getTime() - startOfDay(task.createdAt).getTime()) / (24 * 60 * 60 * 1000)
  );
  return days > 0 ? days : 0;
}

// Plain words on purpose — this lands on a phone, is read in a second, and
// the person reading it needs to know which task and how old it is.
//
// Must never start with "task:", like everything else this app sends: it goes
// out on the connected number, and anything we send comes back through the
// webhook. See parser/noLoop.test.ts.
export function composeRepeatReminder(
  employeeName: string,
  task: OpenRepeatTask,
  statusLabels: Record<string, string>,
  now: Date
): string {
  const lines = [`👋 Hi ${employeeName}, this task is still open:`, "", `*${task.description}*`];
  if (task.clientName) lines.push(`Client: ${task.clientName}`);
  lines.push(`Now: ${statusLabels[task.status] ?? task.status}`);
  lines.push(`Due: ${formatDate(task.dueDate)}`);

  // The whole point of the message. A repeat that has come round again while
  // its last task is untouched is the one thing worth saying out loud.
  const days = daysOpen(task, now);
  if (days === 1) {
    lines.push("Open since: yesterday");
  } else if (days > 1) {
    lines.push(`Open since: ${days} days ago`);
  }

  lines.push("", "It is due again today. Please finish it, or mark it done.");
  lines.push("", "— Team Ecom4all");
  return lines.join("\n");
}

// Never throws — messageEmployee swallows everything, same contract as the
// assignment alert. A reminder that could not be sent must not stop the rest
// of the scheduler pass, and must not put the repeat's clock back: the turn
// genuinely happened, it just had nothing new to create.
export async function remindAboutOpenTask(
  assigneeName: string | null | undefined,
  task: OpenRepeatTask,
  statusLabels: Record<string, string>,
  now: Date,
  channels: WhatsAppChannels
): Promise<boolean> {
  return messageEmployee(
    assigneeName,
    (employeeName) => composeRepeatReminder(employeeName, task, statusLabels, now),
    channels,
    "repeat reminder"
  );
}
