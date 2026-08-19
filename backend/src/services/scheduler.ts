import { prisma } from "../db";
import { taskRepository } from "../repositories/taskRepository";
import { recurringTaskRepository } from "../repositories/recurringTaskRepository";
import { configOptionRepository } from "../repositories/configOptionRepository";
import { advanceNextRunAt, Frequency } from "./recurrence";
import { composeEmployeeReminder, ReminderTask } from "./reminderMessages";
import { notifyAssignee } from "./assignmentNotice";
import { remindAboutOpenTask } from "./repeatReminder";
import { WhatsAppChannels } from "../whatsapp/resolveAdapter";
import { clientRepository } from "../repositories/clientRepository";
import { buildReport, ReportKind } from "./weeklyReportPreview";
import {
  RunResult,
  SEND_GAP_MS,
  composeReportMessage,
  composeRunSummary,
  hasSomethingToSend,
  isDue,
  localDateKey,
  readScheduleConfig,
} from "./reportSchedule";

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

// The local day, not the UTC one — localDateKey, the same key the report
// round already uses. It has to match the clock reminderHour() is read
// against: in the hour that straddles UTC midnight (05:00–05:59 in India) a
// UTC key changes halfway through, which would let the same morning's
// reminder go out twice.
const dateKey = localDateKey;

// Moves a due repeat's clock forward, then creates the Task it was due for —
// unless the last one it made is still open, in which case it reminds whoever
// is holding that one instead. Claiming first is what stops the same run
// producing two identical tasks — see recurringTaskRepository.claim. A claim
// that fails means another pass already has this run, so this one leaves it
// alone.
export async function runDueRecurringTasks(now: Date, channels: WhatsAppChannels): Promise<number> {
  const due = await recurringTaskRepository.due(now);
  let created = 0;

  // Loaded once for the whole pass, and only if there is anything due: the
  // reminder needs status labels ("No Action Yet", not "no_action_yet"), and
  // a pass typically has several repeats coming round together.
  let statusLabels: Record<string, string> | null = null;

  for (const repeat of due) {
    try {
      const claimed = await recurringTaskRepository.claim(
        repeat.id,
        repeat.nextRunAt,
        now,
        advanceNextRunAt(repeat.nextRunAt, repeat.frequency as Frequency, now)
      );
      if (!claimed) {
        console.log(`[scheduler] repeat "${repeat.description}" already run by another pass — left alone`);
        continue;
      }

      // The work is already on the board and unfinished, so this turn has
      // nothing to create. A second copy would say nothing the first one
      // doesn't, and two identical rows a week apart is exactly what the
      // client reported as the system inventing tasks by itself.
      //
      // The clock still moved on above, deliberately: the turn happened, and
      // the next one comes round on schedule and asks the same question
      // again. A task nobody finishes gets a nudge every week, not silence.
      const stillOpen = await taskRepository.openTaskFor({
        lastTaskId: repeat.lastTaskId,
        description: repeat.description,
        sourceRef: repeat.sourceRef,
      });
      if (stillOpen) {
        if (!statusLabels) {
          statusLabels = Object.fromEntries(
            (await configOptionRepository.list("status")).map((o) => [o.value, o.label])
          );
        }
        // Points at the task actually found, which matters on the fallback
        // path: a repeat set up before this existed has nothing recorded, and
        // recording it now means every later turn takes the precise route.
        await recurringTaskRepository.recordTask(repeat.id, stillOpen.id);
        await remindAboutOpenTask(repeat.assignee, stillOpen, statusLabels, now, channels);
        console.log(
          `[scheduler] "${repeat.description}" is still open from last time — reminded ` +
            `${repeat.assignee ?? "nobody (no one is on it)"} instead of creating another`
        );
        continue;
      }

      // Two repeats of the same work can already exist — setting them up is
      // refused now, but the pairs made before that still fire, a second apart
      // in this very loop. The first one through creates the task; the second
      // finds it here and stops, so nobody gets told twice about one job.
      const alreadyThere = await taskRepository.findDuplicateOf(
        { description: repeat.description, sourceRef: repeat.sourceRef },
        now
      );
      if (alreadyThere) {
        console.log(
          `[scheduler] "${repeat.description}" was already created a moment ago — ` +
            `this repeat is a duplicate of another one. Remove it on the Repeating Tasks screen.`
        );
        continue;
      }

      let task;
      try {
        // Carries the triage across too (employee/type/marketplace), so a
        // repeat doesn't come back on the board stripped of decisions someone
        // already made on the task it was created from.
        task = await taskRepository.create({
          source: repeat.source,
          sourceRef: repeat.sourceRef,
          description: repeat.description,
          chatName: repeat.chatName ?? undefined,
          clientName: repeat.clientName ?? undefined,
          assignee: repeat.assignee,
          taskType: repeat.taskType,
          marketplace: repeat.marketplace,
        });
      } catch (err) {
        // Nothing was created, so hand the run back: the clock returns to what
        // it was and the next tick tries again. Only the claim is undone — a
        // repeat is never left further ahead than it started.
        await recurringTaskRepository.releaseClaim(repeat.id, repeat.nextRunAt, repeat.lastRunAt);
        throw err;
      }

      created += 1;

      // Remembered so next week's turn can see whether this was ever
      // finished. Best-effort: the task is already made and the person
      // already being told, and a repeat that failed to record it falls back
      // to matching on wording rather than losing the chase entirely.
      try {
        await recurringTaskRepository.recordTask(repeat.id, task.id);
      } catch (err) {
        console.error(`[scheduler] couldn't record the task made by repeat ${repeat.id}:`, err);
      }

      // A repeat that carries an assignee is a fresh piece of work landing on
      // that person, so they get the same "this is yours" message as any
      // other assignment. Never throws — see notifyAssignee.
      await notifyAssignee(
        task.assignee,
        { description: task.description, clientName: task.clientName, dueDate: task.dueDate },
        channels
      );
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

// In memory, like lastReminderDate above. A restart inside the scheduled hour
// could start the round a second time, so this is the one place where that
// matters most — the messages go to clients, not to us. It's kept in memory
// anyway, for one reason: the round only fires in a single hour of a single
// day, and a redeploy landing inside that exact hour is rare, while a
// database table whose every row would be identical is permanent. If a
// double-send ever actually happens, this is the line to move into Postgres.
let lastReportRunOn: string | null = null;

// The scheduled report round: on the chosen day and hour, every client with a
// report sheet linked is sent their report, five seconds apart, with no one
// pressing anything.
//
// This messages clients directly, which is why so much of it is about not
// sending. A client is skipped rather than sent to when their sheet has no
// figures for the period, when their sheet can't be opened, or when there's
// nowhere to send it — an empty or broken report is worse than a late one,
// because the client reads it as the state of their account.
//
// Whatever happens, the team gets one summary afterwards. Without it a silent
// failure looks exactly like a quiet week.
export async function runScheduledReports(now: Date, channels: WhatsAppChannels): Promise<RunResult[]> {
  const config = readScheduleConfig();
  if (!isDue(config, now, lastReportRunOn)) return [];

  // Claimed before any sending starts. If the round throws half way, the next
  // tick five minutes later must not start it again and send the first
  // clients their report twice.
  lastReportRunOn = localDateKey(now);

  const clients = await clientRepository.listWithReportSheet();
  const marketplaceLabels = Object.fromEntries(
    (await configOptionRepository.list("marketplace")).map((option) => [option.value, option.label])
  );

  // One send per sheet, not per client: a client selling on Amazon and
  // Flipkart has two separate sets of figures and gets two messages, each
  // headed with its own marketplace. Flattened up front so the gap between
  // sends, and the "was that the last one" check, count actual messages.
  const sends = clients.flatMap((client) =>
    client.reportSheets.map((sheet) => ({ client, sheet }))
  );
  const results: RunResult[] = [];

  for (const [index, { client, sheet }] of sends.entries()) {
    // Every result is named by client *and* marketplace, so the summary that
    // goes to staff afterwards can say which of a client's two reports failed.
    const marketplaceLabel = marketplaceLabels[sheet.marketplace] ?? sheet.marketplace;
    const reportedAs = `${client.name} (${marketplaceLabel})`;

    // Groups first, phone second — the same order the Weekly Reports screen
    // defaults to, so an automatic send lands in the same chat a manual one
    // would have.
    const target = client.whatsappGroups[0]?.groupId ?? client.phone?.trim();
    if (!target) {
      results.push({ clientName: reportedAs, sent: false, skipped: "nowhere to send it" });
      continue;
    }

    let message: string;
    try {
      const report = await buildReport(sheet.sheetUrl, config.kind, now);
      if (!hasSomethingToSend(report)) {
        results.push({ clientName: reportedAs, sent: false, skipped: "no figures for this period" });
        continue;
      }
      // Named in the message only when there's more than one to tell apart.
      // A client with a single sheet gets exactly the message they got
      // before this change.
      message = composeReportMessage(
        client.name,
        config.kind,
        report,
        now,
        client.reportSheets.length > 1 ? marketplaceLabel : undefined
      );
    } catch (err) {
      console.error(`[scheduler] couldn't build ${reportedAs}'s report:`, err);
      results.push({ clientName: reportedAs, sent: false, skipped: "couldn't open the sheet" });
      continue;
    }

    try {
      await channels.whapi.sendMessage(target, message);
      results.push({ clientName: reportedAs, sent: true });
      console.log(`[scheduler] sent ${config.kind} report to ${reportedAs}`);
    } catch (err) {
      const reason = err instanceof Error ? err.message.slice(0, 120) : "send failed";
      console.error(`[scheduler] failed to send ${reportedAs}'s report:`, err);
      results.push({ clientName: reportedAs, sent: false, failed: reason });
    }

    // Only between sends — no point holding the round open after the last one.
    // Counted over attempts rather than successes: a rejected send still cost
    // the connected number a request. Two sheets on one client are two
    // messages to the same chat, so the gap matters more here, not less.
    if (index < sends.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, SEND_GAP_MS));
    }
  }

  await tellStaffWhatWentOut(config.kind, results, now, channels);
  return results;
}

// Admins and managers only: they're the roles that can open the report
// screens, so they're the ones who can act on anything that didn't go.
async function tellStaffWhatWentOut(
  kind: ReportKind,
  results: RunResult[],
  now: Date,
  channels: WhatsAppChannels
): Promise<void> {
  const summary = composeRunSummary(kind, results, now);
  if (!summary) {
    console.log("[scheduler] report round fired with no clients to send to");
    return;
  }

  const staff = await prisma.employee.findMany({
    where: { tenantId: "default", active: true, role: { in: ["admin", "manager"] } },
  });

  for (const person of staff) {
    if (!person.phone) continue;
    try {
      await channels.whapi.sendMessage(person.phone, summary);
    } catch (err) {
      // The reports themselves already went out; failing to report on that
      // must not throw into the tick.
      console.error(`[scheduler] couldn't send the round summary to ${person.name}:`, err);
    }
  }
}

// A tick has no time limit of its own, and one of them can genuinely outlast
// the five minutes until the next: a report round sends every client five
// seconds apart, and reads a Google sheet for each. setInterval doesn't wait,
// so without this two passes would run over each other — both seeing the same
// due repeats, both about to create the same tasks. The claim in
// runDueRecurringTasks would now catch that, but a tick skipped whole is
// cheaper than one raced and half-discarded, and it keeps the report round
// single-file too.
let ticking = false;

async function tick(channels: WhatsAppChannels) {
  if (ticking) {
    console.log("[scheduler] previous pass still running — skipping this one");
    return;
  }
  ticking = true;
  const now = new Date();

  // finally, not the end of the happy path: a throw that escaped the three
  // guards below would otherwise leave this stuck on, and the scheduler would
  // never run again until the next redeploy.
  try {
    try {
      await runDueRecurringTasks(now, channels);
    } catch (err) {
      console.error("[scheduler] recurring task pass failed:", err);
    }

    try {
      await runScheduledReports(now, channels);
    } catch (err) {
      console.error("[scheduler] scheduled report round failed:", err);
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
  } finally {
    ticking = false;
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
