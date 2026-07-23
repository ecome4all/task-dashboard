import { Router } from "express";
import { taskRepository } from "../repositories/taskRepository";
import { configOptionRepository } from "../repositories/configOptionRepository";
import { WhatsAppChannels, resolveAdapterForSource } from "../whatsapp/resolveAdapter";

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
    const { assignee, status, taskType, marketplace } = req.body;

    const [statusOptions, taskTypeOptions, marketplaceOptions] = await Promise.all([
      configOptionRepository.list("status"),
      configOptionRepository.list("task_type"),
      configOptionRepository.list("marketplace"),
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

    const task = await taskRepository.update(req.params.id, { assignee, status, taskType, marketplace });

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
