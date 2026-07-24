import { Router } from "express";
import { taskRepository } from "../repositories/taskRepository";
import { configOptionRepository } from "../repositories/configOptionRepository";
import { employeeRepository } from "../repositories/employeeRepository";
import { WhatsAppChannels, resolveAdapterForSource } from "../whatsapp/resolveAdapter";
import { composeSendUpdateMessage, changedFieldsSince, buildSnapshot, TaskSnapshot } from "../services/taskMessages";

const DUE_DATE_ROLES = ["admin", "manager"];

export function createTasksRouter(channels: WhatsAppChannels) {
  const router = Router();

  router.get("/", async (_req, res) => {
    const tasks = await taskRepository.list();
    // The Send button needs to know, per task, whether anything's changed
    // since the last send — computed here rather than trusting the client
    // to track it, since staff on different devices/sessions share one
    // "what's already been told to the client" snapshot.
    res.json(
      tasks.map((task) => ({
        ...task,
        pendingSendFields: changedFieldsSince(task, task.sentSnapshot as TaskSnapshot | null),
      }))
    );
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

    // Only "done" is announced back to the group automatically — every
    // other status change is just internal triage the client doesn't need
    // pinged about. Uses the same composer as the manual Send button, just
    // forced to the single "status" field, so both message paths stay
    // worded identically. This send is best-effort: the status update
    // itself is already saved above, and a WhatsApp failure (network blip,
    // bad chat_id, Periskope outage) must not fail the request or crash the
    // server — an uncaught rejection here would take down the whole
    // process, not just this one notification.
    // Tracks what the response's pendingSendFields should reflect -- starts
    // as the snapshot already on the task, and gets the status field merged
    // in below on a successful automatic send, without needing a re-fetch.
    // A non-"done" status change leaves the snapshot untouched, so it still
    // shows up as pending on the manual Send button instead of being lost.
    let currentSnapshot = task.sentSnapshot as TaskSnapshot | null;
    if (status !== undefined && task.status === "done") {
      try {
        const whatsapp = resolveAdapterForSource(task.source, channels);
        const statusLabels = Object.fromEntries(statusOptions.map((o) => [o.value, o.label]));
        const marketplaceLabels = Object.fromEntries(marketplaceOptions.map((o) => [o.value, o.label]));
        const message = composeSendUpdateMessage({
          description: task.description,
          fields: ["status"],
          status: task.status,
          marketplace: task.marketplace,
          assignee: task.assignee,
          dueDate: task.dueDate,
          statusLabels,
          marketplaceLabels,
        });
        await whatsapp.sendMessage(task.sourceRef, message);
        // Merge just the status field into the existing snapshot, so a
        // later manual Send doesn't restate a status change that was
        // already announced automatically here.
        currentSnapshot = { ...currentSnapshot, status: task.status };
        await taskRepository.updateSnapshot(task.id, currentSnapshot);
      } catch (err) {
        console.error("Failed to send WhatsApp status update:", err);
      }
    }

    res.json({ ...task, pendingSendFields: changedFieldsSince(task, currentSnapshot) });
  });

  // Manual send: unlike the automatic status-change notification above,
  // this is for telling a client about anything else on a task. No field
  // picking — it automatically works out what's changed since the last
  // send (manual or automatic) for this task and sends exactly that.
  router.post("/:id/send-update", async (req, res) => {
    const task = await taskRepository.findById(req.params.id);
    if (!task) {
      res.status(404).json({ error: "task not found" });
      return;
    }

    const fields = changedFieldsSince(task, task.sentSnapshot as TaskSnapshot | null);
    if (fields.length === 0) {
      res.status(400).json({ error: "Nothing new to send since the last update." });
      return;
    }

    const needStatusOptions = fields.includes("status");
    // The "Waiting for <marketplace>" status label depends on the
    // marketplace list too, even if marketplace itself isn't being sent.
    const needMarketplaceOptions = fields.includes("marketplace") || needStatusOptions;

    const [statusOptions, marketplaceOptions] = await Promise.all([
      needStatusOptions ? configOptionRepository.list("status") : Promise.resolve([]),
      needMarketplaceOptions ? configOptionRepository.list("marketplace") : Promise.resolve([]),
    ]);
    const statusLabels = Object.fromEntries(statusOptions.map((o) => [o.value, o.label]));
    const marketplaceLabels = Object.fromEntries(marketplaceOptions.map((o) => [o.value, o.label]));

    const message = composeSendUpdateMessage({
      description: task.description,
      fields,
      status: task.status,
      marketplace: task.marketplace,
      assignee: task.assignee,
      dueDate: task.dueDate,
      statusLabels,
      marketplaceLabels,
    });

    try {
      const whatsapp = resolveAdapterForSource(task.source, channels);
      await whatsapp.sendMessage(task.sourceRef, message);
    } catch (err) {
      console.error("Failed to send manual task update:", err);
      res.status(502).json({ error: "Couldn't send the message. Try again." });
      return;
    }

    await taskRepository.updateSnapshot(task.id, buildSnapshot(task));
    res.json({ sent: true, fields });
  });

  return router;
}
