import { Router } from "express";
import { taskRepository } from "../repositories/taskRepository";
import { configOptionRepository } from "../repositories/configOptionRepository";
import { employeeRepository } from "../repositories/employeeRepository";
import { WhatsAppChannels, resolveAdapterForSource } from "../whatsapp/resolveAdapter";

const DUE_DATE_ROLES = ["admin", "manager"];

// "Waiting for Amazon" needs to read "Waiting for Flipkart" etc. depending on
// the task's own marketplace column — falls back to a generic word when the
// marketplace hasn't been triaged yet, or its label can't be found (e.g. it
// was since deactivated). Status/marketplace labels come from ConfigOption,
// not hardcoded, so admins can rename or add options without a code change.
function statusLabel(
  status: string,
  marketplace: string | null,
  statusLabels: Record<string, string>,
  marketplaceLabels: Record<string, string>
): string {
  if (status === "waiting_for_marketplace") {
    return `Waiting for ${(marketplace && marketplaceLabels[marketplace]) || "Marketplace"}`;
  }
  return statusLabels[status] ?? status;
}

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

  return router;
}
