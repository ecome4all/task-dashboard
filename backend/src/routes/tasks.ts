import { Router } from "express";
import { taskRepository } from "../repositories/taskRepository";
import { configOptionRepository } from "../repositories/configOptionRepository";
import { employeeRepository } from "../repositories/employeeRepository";
import { WhatsAppChannels, resolveAdapterForSource } from "../whatsapp/resolveAdapter";
import { statusLabel, composeSendUpdateMessage } from "../services/taskMessages";

const DUE_DATE_ROLES = ["admin", "manager"];

// Fields a manual "Send Update" can include — separate from the automatic
// status-change notification below, for anything else worth telling a
// client about (a marketplace decision, who's on it, a due date, etc.),
// alone or mixed together in one message.
const SENDABLE_FIELDS = ["status", "marketplace", "taskType", "assignee", "dueDate", "createdAt"];

export function createTasksRouter(channels: WhatsAppChannels) {
  const router = Router();

  router.get("/", async (_req, res) => {
    const tasks = await taskRepository.list();
    res.json(tasks);
  });

  router.patch("/:id", async (req, res) => {
    const { assignee, status, taskType, marketplace, dueDate } = req.body;

    // Only fetch the option lists this particular request actually needs —
    // e.g. changing just the assignee needs none of these, and changing
    // just the marketplace doesn't need status/taskType. Each list was
    // being fetched unconditionally on every PATCH, which is 2-3 needless
    // DB round trips (felt as UI lag) for the common case of editing one
    // field at a time. marketplaceOptions is also needed whenever status
    // changes, since the "Waiting for <marketplace>" WhatsApp label below
    // depends on it regardless of whether marketplace itself changed.
    const needStatusOptions = status !== undefined;
    const needTaskTypeOptions = taskType !== undefined && taskType !== null;
    const needMarketplaceOptions = (marketplace !== undefined && marketplace !== null) || status !== undefined;

    const [statusOptions, taskTypeOptions, marketplaceOptions] = await Promise.all([
      needStatusOptions ? configOptionRepository.list("status") : Promise.resolve([]),
      needTaskTypeOptions ? configOptionRepository.list("task_type") : Promise.resolve([]),
      needMarketplaceOptions ? configOptionRepository.list("marketplace") : Promise.resolve([]),
    ]);

    if (status !== undefined && !statusOptions.some((o) => o.value === status)) {
      res.status(400).json({ error: "invalid status" });
      return;
    }
    if (taskType !== undefined && taskType !== null && !taskTypeOptions.some((o) => o.value === taskType)) {
      res.status(400).json({ error: "invalid taskType" });
      return;
    }
    if (marketplace !== undefined && marketplace !== null && !marketplaceOptions.some((o) => o.value === marketplace)) {
      res.status(400).json({ error: "invalid marketplace" });
      return;
    }

    let parsedDueDate: Date | null | undefined;
    if (dueDate !== undefined) {
      // Only an admin or manager can set a task's due date — members can
      // edit everything else on a task, but not this.
      const employee = await employeeRepository.findById(req.employeeId!);
      if (!employee || !DUE_DATE_ROLES.includes(employee.role)) {
        res.status(403).json({ error: "only an admin or manager can set the due date" });
        return;
      }
      if (dueDate === null) {
        parsedDueDate = null;
      } else {
        const parsed = new Date(dueDate);
        if (Number.isNaN(parsed.getTime())) {
          res.status(400).json({ error: "invalid dueDate" });
          return;
        }
        parsedDueDate = parsed;
      }
    }

    const task = await taskRepository.update(req.params.id, {
      assignee,
      status,
      taskType,
      marketplace,
      dueDate: parsedDueDate,
    });

    // Every status change is announced back to the group it came from, not
    // just "done" — the client wants visibility into the whole pipeline.
    // This send is best-effort: the status update itself is already saved
    // above, and a WhatsApp failure (network blip, bad chat_id, Periskope
    // outage) must not fail the request or crash the server — an uncaught
    // rejection here would take down the whole process, not just this one
    // notification.
    if (status !== undefined) {
      try {
        const whatsapp = resolveAdapterForSource(task.source, channels);
        const statusLabels = Object.fromEntries(statusOptions.map((o) => [o.value, o.label]));
        const marketplaceLabels = Object.fromEntries(marketplaceOptions.map((o) => [o.value, o.label]));
        await whatsapp.sendMessage(
          task.sourceRef,
          `Task: ${task.description}\nUpdate: ${statusLabel(status, task.marketplace, statusLabels, marketplaceLabels)}`
        );
      } catch (err) {
        console.error("Failed to send WhatsApp status update:", err);
      }
    }

    res.json(task);
  });

  // Manual send: unlike the automatic status-change notification above,
  // this is for telling a client about anything else on a task — one field
  // or several at once — whenever staff decides it's worth a message, not
  // tied to any particular edit.
  router.post("/:id/send-update", async (req, res) => {
    const { fields } = req.body;
    if (!Array.isArray(fields) || fields.length === 0 || !fields.every((f) => SENDABLE_FIELDS.includes(f))) {
      res.status(400).json({ error: `fields must be a non-empty array of: ${SENDABLE_FIELDS.join(", ")}` });
      return;
    }

    const task = await taskRepository.findById(req.params.id);
    if (!task) {
      res.status(404).json({ error: "task not found" });
      return;
    }

    const needStatusOptions = fields.includes("status");
    const needTaskTypeOptions = fields.includes("taskType");
    // The "Waiting for <marketplace>" status label depends on the
    // marketplace list too, even if marketplace itself isn't being sent.
    const needMarketplaceOptions = fields.includes("marketplace") || needStatusOptions;

    const [statusOptions, taskTypeOptions, marketplaceOptions] = await Promise.all([
      needStatusOptions ? configOptionRepository.list("status") : Promise.resolve([]),
      needTaskTypeOptions ? configOptionRepository.list("task_type") : Promise.resolve([]),
      needMarketplaceOptions ? configOptionRepository.list("marketplace") : Promise.resolve([]),
    ]);
    const statusLabels = Object.fromEntries(statusOptions.map((o) => [o.value, o.label]));
    const taskTypeLabels = Object.fromEntries(taskTypeOptions.map((o) => [o.value, o.label]));
    const marketplaceLabels = Object.fromEntries(marketplaceOptions.map((o) => [o.value, o.label]));

    const message = composeSendUpdateMessage({
      description: task.description,
      fields: fields as string[],
      status: task.status,
      marketplace: task.marketplace,
      taskType: task.taskType,
      assignee: task.assignee,
      dueDate: task.dueDate,
      createdAt: task.createdAt,
      statusLabels,
      marketplaceLabels,
      taskTypeLabels,
    });

    try {
      const whatsapp = resolveAdapterForSource(task.source, channels);
      await whatsapp.sendMessage(task.sourceRef, message);
    } catch (err) {
      console.error("Failed to send manual task update:", err);
      res.status(502).json({ error: "Couldn't send the message. Try again." });
      return;
    }

    res.json({ sent: true });
  });

  return router;
}
