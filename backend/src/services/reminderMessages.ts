import { ReportField } from "./reportPeriod";

export interface ReminderTask {
  description: string;
  status: string;
  clientName: string | null;
  dueDate: Date | null;
}

function formatDay(date: Date): string {
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

// Start of the given day, so "late" means the due date has actually passed
// rather than "it's past midnight on the day it's due".
function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

export function isLate(task: ReminderTask, now: Date): boolean {
  return task.dueDate !== null && task.dueDate.getTime() < startOfDay(now).getTime();
}

function isDueToday(task: ReminderTask, now: Date): boolean {
  if (!task.dueDate) return false;
  return startOfDay(task.dueDate).getTime() === startOfDay(now).getTime();
}

// The daily "here's your open work" message for one employee. Late tasks go
// first and are marked, because that's the part that needs acting on today;
// everything else is listed underneath so the message is a complete picture
// rather than only bad news. Returns null when there's nothing open at all —
// the caller skips sending entirely rather than delivering "you have 0 tasks"
// every morning, which is how a reminder becomes noise people mute.
export function composeEmployeeReminder(
  employeeName: string,
  tasks: ReminderTask[],
  statusLabels: Record<string, string>,
  now: Date
): string | null {
  if (tasks.length === 0) return null;

  const late = tasks.filter((t) => isLate(t, now));
  const today = tasks.filter((t) => isDueToday(t, now));
  const rest = tasks.filter((t) => !isLate(t, now) && !isDueToday(t, now));

  const lines: string[] = [];
  lines.push(`👋 Good morning ${employeeName}, here's your work:`);

  function section(title: string, group: ReminderTask[]) {
    if (group.length === 0) return;
    lines.push("");
    lines.push(`*${title}*`);
    for (const task of group) {
      const parts = [task.description];
      if (task.clientName) parts.push(`(${task.clientName})`);
      const status = statusLabels[task.status] ?? task.status;
      parts.push(`— ${status}`);
      if (task.dueDate) parts.push(`· due ${formatDay(task.dueDate)}`);
      lines.push(`• ${parts.join(" ")}`);
    }
  }

  section(`Late (${late.length})`, late);
  section(`Due today (${today.length})`, today);
  section(`Still open (${rest.length})`, rest);

  lines.push("");
  lines.push("— Team Ecom4all");
  return lines.join("\n");
}

export type { ReportField };
