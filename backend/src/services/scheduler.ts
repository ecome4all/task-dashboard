import { prisma } from "../db";
import { taskRepository } from "../repositories/taskRepository";
import { recurringTaskRepository } from "../repositories/recurringTaskRepository";
import { configOptionRepository } from "../repositories/configOptionRepository";
import { advanceNextRunAt, Frequency } from "./recurrence";
import { composeEmployeeReminder, ReminderTask } from "./reminderMessages";
import { WhatsAppChannels } from "../whatsapp/resolveAdapter";

// How often the scheduler wakes up. Everything it does is driven by stored
// timestamps rather than by the tick itself, so this interval only decides
// how promptly work is picked up, never whether it happens at all — a
// backend that was down over a tick catches up on its next one.
const TICK_MS = 5 * 60 * 1000;

// Local hour the daily employee reminder goes out. Deliberately a whole
// hour: the tick is every 5 minutes, so the job fires on the first tick
// inside that hour and the "already sent today" guard below stops the
// remaining eleven from sending it again.
function reminderHour(): number {
  const configured = Number(process.env.REMINDER_HOUR);
  return Number.isInteger(configured) && configured >= 0 && configured <= 23 ? configured : 9;
}

// In-memory, deliberately: the only thing it protects against is the same
// process sending twice in one hour. A restart re-sends at most one extra
// reminder, which is a far better failure mode than a missed one, and it
// keeps a scheduling detail out of the client's database.
let lastReminderDate: string | null = null;

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// Creates the Task a repeat is due for, then moves its clock forward. Order
// matters: if creating the task throws, the clock is left alone so the next
// tick retries rather than silently skipping this run.
export async function runDueRecurringTasks(now: Date): Promise<number> {
  const due = await recurringTaskRepository.due(now);
  let created = 0;

  for (const repeat of due) {
    try {
      // Carries the triage across too (employee/type/marketplace), so a
      // repeat doesn't come back on the board stripped of decisions someone
      // already made on the task it was created from.
      await taskRepository.create({
        source: repeat.source,
        sourceRef: repeat.sourceRef,
        description: repeat.description,
        chatName: repeat.chatName ?? undefined,
        clientName: repeat.clientName ?? undefined,
        assignee: repeat.assignee,
        taskType: repeat.taskType,
        marketplace: repeat.marketplace,
      });

      await recurringTaskRepository.markRun(
        repeat.id,
        now,
        advanceNextRunAt(repeat.nextRunAt, repeat.frequency as Frequency, now)
      );
      created += 1;
      console.log(`[scheduler] created repeating task "${repeat.description}" (${repeat.frequency})`);
    } catch (err) {
      console.error(`[scheduler] failed to run repeat ${repeat.id}:`, err);
    }
  }

  return created;
}

// One WhatsApp message per employee listing their own open work. Employees
// with no phone saved, or with nothing open, are skipped rather than sent an
// empty message — see composeEmployeeReminder.
export async function sendEmployeeReminders(now: Date, channels: WhatsAppChannels): Promise<number> {
  const [employees, tasks, statusOptions] = await Promise.all([
    prisma.employee.findMany({ where: { tenantId: "default", active: true } }),
    prisma.task.findMany({ where: { tenantId: "default", status: { not: "done" } } }),
    configOptionRepository.list("status"),
  ]);

  const statusLabels = Object.fromEntries(statusOptions.map((o) => [o.value, o.label]));
  let sent = 0;

  for (const employee of employees) {
    if (!employee.phone) continue;

    const mine: ReminderTask[] = tasks
      .filter((t) => t.assignee === employee.name)
      .map((t) => ({
        description: t.description,
        status: t.status,
        clientName: t.clientName,
        dueDate: t.dueDate,
      }));

    const message = composeEmployeeReminder(employee.name, mine, statusLabels, now);
    if (!message) continue;

    try {
      // Reminders go out on the group channel's adapter — it's the one
      // connected to a real WhatsApp number that can message an arbitrary
      // person, unlike the official Cloud API, which can only reply inside
      // a 24-hour window opened by the recipient.
      await channels.whapi.sendMessage(employee.phone, message);
      sent += 1;
    } catch (err) {
      // One employee's send failing must not stop the rest of the round.
      console.error(`[scheduler] failed to send reminder to ${employee.name}:`, err);
    }
  }

  return sent;
}

async function tick(channels: WhatsAppChannels) {
  const now = new Date();

  try {
    await runDueRecurringTasks(now);
  } catch (err) {
    console.error("[scheduler] recurring task pass failed:", err);
  }

  try {
    const today = dateKey(now);
    if (now.getHours() === reminderHour() && lastReminderDate !== today) {
      lastReminderDate = today;
      const sent = await sendEmployeeReminders(now, channels);
      console.log(`[scheduler] sent ${sent} employee reminder(s)`);
    }
  } catch (err) {
    console.error("[scheduler] reminder pass failed:", err);
  }
}

// Started from server.ts. Everything inside a tick is wrapped so a failure
// can't reject into the timer callback — an unhandled rejection there would
// take the whole process down, which is exactly the production incident the
// outbound sends were already hardened against.
export function startScheduler(channels: WhatsAppChannels) {
  if (process.env.DISABLE_SCHEDULER === "true") {
    console.log("[scheduler] disabled via DISABLE_SCHEDULER");
    return;
  }

  console.log(`[scheduler] started — checking every ${TICK_MS / 60000} minutes, reminders at ${reminderHour()}:00`);
  // Not run immediately on boot: a redeploy loop would otherwise fire a
  // catch-up pass on every restart.
  const timer = setInterval(() => {
    void tick(channels);
  }, TICK_MS);
  // Don't hold the process open on shutdown purely because a timer is armed.
  timer.unref();
}
