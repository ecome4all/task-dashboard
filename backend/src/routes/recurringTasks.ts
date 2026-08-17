import { Router } from "express";
import { recurringTaskRepository } from "../repositories/recurringTaskRepository";
import { taskRepository } from "../repositories/taskRepository";
import { employeeRepository } from "../repositories/employeeRepository";
import { requireRole } from "../auth/requireRole";
import { isFrequency, firstRunAt, FREQUENCIES } from "../services/recurrence";
import { taskVisibilityFor } from "../services/taskVisibility";
import { whyRepeatWouldDuplicate } from "../services/repeatDuplicates";

// Same audience as due dates: setting up work that will keep appearing on
// everyone's board is a scheduling decision, not day-to-day triage.
const MANAGE_ROLES = ["admin", "manager"];

// Built from the list rather than typed out, so adding a frequency doesn't
// leave the rejection message naming the old set.
const FREQUENCY_ERROR = `frequency must be one of: ${FREQUENCIES.join(", ")}`;

export function createRecurringTasksRouter() {
  const router = Router();

  // Readable by any logged-in employee — a member seeing why a task keeps
  // reappearing is useful. Limited to their own repeats, though, by the same
  // rule that limits their board: a repeat set up for a manager is a manager's
  // work, and every task it goes on to produce would be hidden from them too.
  router.get("/", async (req, res) => {
    res.json(await recurringTaskRepository.list(taskVisibilityFor(req.employee)));
  });

  // "Repeat this" on an existing task: copies that task's details into a
  // standalone repeat. Deliberately a copy rather than a reference — the
  // original can be edited, completed or deleted afterwards, and none of
  // that should change or break what the repeat goes on producing.
  router.post("/", requireRole(...MANAGE_ROLES), async (req, res) => {
    const { taskId, frequency, nextRunAt } = req.body;

    if (!isFrequency(frequency)) {
      res.status(400).json({ error: FREQUENCY_ERROR });
      return;
    }

    // When the first one should be made. Chosen by whoever sets the repeat up
    // rather than assumed — "every week" says nothing about which day or what
    // time, and guessing produced tasks at whatever moment the button happened
    // to be clicked. Falls back to one interval from now only if it's omitted.
    let firstRun: Date;
    if (nextRunAt === undefined || nextRunAt === null || nextRunAt === "") {
      firstRun = firstRunAt(new Date(), frequency);
    } else {
      const parsed = new Date(nextRunAt);
      if (Number.isNaN(parsed.getTime())) {
        res.status(400).json({ error: "Enter a valid date and time for the first one." });
        return;
      }
      firstRun = parsed;
    }

    const task = await taskRepository.findById(taskId);
    if (!task) {
      res.status(404).json({ error: "task not found" });
      return;
    }

    // Checked against every repeat, not only the ones this person can see:
    // a member's board hides a manager's repeats, but a hidden duplicate
    // still fires. Refusing is right rather than merely warning — the cost of
    // a wrong refusal is one visit to the Repeating Tasks screen, and the cost
    // of a wrong allow is a second copy of a task every week from then on,
    // messaged to whoever it lands on each time.
    const duplicate = whyRepeatWouldDuplicate(
      {
        description: task.description,
        clientName: task.clientName,
        assignee: task.assignee,
        frequency,
      },
      await recurringTaskRepository.list()
    );
    if (duplicate) {
      res.status(409).json({ error: duplicate });
      return;
    }

    const employee = await employeeRepository.findById(req.employeeId!);

    res.status(201).json(
      await recurringTaskRepository.create({
        source: task.source,
        sourceRef: task.sourceRef,
        chatName: task.chatName,
        description: task.description,
        clientName: task.clientName,
        assignee: task.assignee,
        taskType: task.taskType,
        marketplace: task.marketplace,
        frequency,
        nextRunAt: firstRun,
        createdBy: employee?.name ?? "Unknown",
      })
    );
  });

  router.patch("/:id", requireRole(...MANAGE_ROLES), async (req, res) => {
    const { active, frequency, nextRunAt } = req.body;

    if (active !== undefined && typeof active !== "boolean") {
      res.status(400).json({ error: "active must be true or false" });
      return;
    }
    if (frequency !== undefined && !isFrequency(frequency)) {
      res.status(400).json({ error: FREQUENCY_ERROR });
      return;
    }

    let parsedNextRun: Date | undefined;
    if (nextRunAt !== undefined) {
      const parsed = new Date(nextRunAt);
      if (Number.isNaN(parsed.getTime())) {
        res.status(400).json({ error: "Enter a valid date and time." });
        return;
      }
      parsedNextRun = parsed;
    }

    const existing = await recurringTaskRepository.findById(req.params.id);
    if (!existing) {
      res.status(404).json({ error: "repeating task not found" });
      return;
    }

    res.json(
      await recurringTaskRepository.update(req.params.id, {
        ...(active !== undefined && { active }),
        // Changing how often it repeats deliberately leaves the next date
        // alone: "every week instead of every day" shouldn't silently move
        // the run to some other day. Change the date explicitly if you want
        // it moved.
        ...(frequency !== undefined && { frequency }),
        ...(parsedNextRun !== undefined && { nextRunAt: parsedNextRun }),
      })
    );
  });

  router.delete("/:id", requireRole(...MANAGE_ROLES), async (req, res) => {
    const existing = await recurringTaskRepository.findById(req.params.id);
    if (!existing) {
      res.status(404).json({ error: "repeating task not found" });
      return;
    }
    await recurringTaskRepository.delete(req.params.id);
    res.status(204).send();
  });

  return router;
}
