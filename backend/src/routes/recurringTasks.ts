import { Router } from "express";
import { recurringTaskRepository } from "../repositories/recurringTaskRepository";
import { taskRepository } from "../repositories/taskRepository";
import { employeeRepository } from "../repositories/employeeRepository";
import { requireRole } from "../auth/requireRole";
import { isFrequency, firstRunAt } from "../services/recurrence";

// Same audience as due dates: setting up work that will keep appearing on
// everyone's board is a scheduling decision, not day-to-day triage.
const MANAGE_ROLES = ["admin", "manager"];

export function createRecurringTasksRouter() {
  const router = Router();

  // Readable by any logged-in employee — a member seeing why a task keeps
  // reappearing is useful, and there's nothing sensitive in the list.
  router.get("/", async (_req, res) => {
    res.json(await recurringTaskRepository.list());
  });

  // "Repeat this" on an existing task: copies that task's details into a
  // standalone repeat. Deliberately a copy rather than a reference — the
  // original can be edited, completed or deleted afterwards, and none of
  // that should change or break what the repeat goes on producing.
  router.post("/", requireRole(...MANAGE_ROLES), async (req, res) => {
    const { taskId, frequency } = req.body;

    if (!isFrequency(frequency)) {
      res.status(400).json({ error: "frequency must be daily, weekly or monthly" });
      return;
    }

    const task = await taskRepository.findById(taskId);
    if (!task) {
      res.status(404).json({ error: "task not found" });
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
        // One interval from now, so setting up a weekly repeat doesn't
        // immediately duplicate the task you're looking at.
        nextRunAt: firstRunAt(new Date(), frequency),
        createdBy: employee?.name ?? "Unknown",
      })
    );
  });

  router.patch("/:id", requireRole(...MANAGE_ROLES), async (req, res) => {
    const { active, frequency } = req.body;

    if (active !== undefined && typeof active !== "boolean") {
      res.status(400).json({ error: "active must be true or false" });
      return;
    }
    if (frequency !== undefined && !isFrequency(frequency)) {
      res.status(400).json({ error: "frequency must be daily, weekly or monthly" });
      return;
    }

    const existing = await recurringTaskRepository.findById(req.params.id);
    if (!existing) {
      res.status(404).json({ error: "repeating task not found" });
      return;
    }

    res.json(
      await recurringTaskRepository.update(req.params.id, {
        ...(active !== undefined && { active }),
        // Changing how often it repeats restarts the clock from now, rather
        // than keeping a nextRunAt that was worked out for the old interval.
        ...(frequency !== undefined && { frequency, nextRunAt: firstRunAt(new Date(), frequency) }),
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
