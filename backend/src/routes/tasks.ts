import { Router } from "express";
import { taskRepository } from "../repositories/taskRepository";
import { WhatsAppChannels, resolveAdapterForSource } from "../whatsapp/resolveAdapter";

const STATUSES = ["started", "submitted", "waiting_for_marketplace", "waiting_for_client", "again_submitted", "done"];
const TASK_TYPES = [
  "listing",
  "inventory_manage",
  "fba",
  "claims",
  "inactive_blocked_product",
  "no_pickup",
  "ads",
  "other",
];
const MARKETPLACES = ["amazon", "flipkart", "meesho", "other"];
const MARKETPLACE_LABEL: Record<string, string> = { amazon: "Amazon", flipkart: "Flipkart", meesho: "Meesho" };

// "Waiting for Amazon" needs to read "Waiting for Flipkart" etc. depending on
// the task's own marketplace column — falls back to a generic word when the
// marketplace hasn't been triaged yet (or is "other").
function statusLabel(status: string, marketplace: string | null): string {
  const labels: Record<string, string> = {
    started: "Started",
    submitted: "Submitted",
    waiting_for_marketplace: `Waiting for ${(marketplace && MARKETPLACE_LABEL[marketplace]) || "Marketplace"}`,
    waiting_for_client: "Waiting for Client",
    again_submitted: "Again Submitted",
    done: "Done",
  };
  return labels[status] ?? status;
}

export function createTasksRouter(channels: WhatsAppChannels) {
  const router = Router();

  router.get("/", async (_req, res) => {
    const tasks = await taskRepository.list();
    res.json(tasks);
  });

  router.patch("/:id", async (req, res) => {
    const { assignee, status, taskType, marketplace } = req.body;
    if (status !== undefined && !STATUSES.includes(status)) {
      res.status(400).json({ error: "invalid status" });
      return;
    }
    if (taskType !== undefined && taskType !== null && !TASK_TYPES.includes(taskType)) {
      res.status(400).json({ error: "invalid taskType" });
      return;
    }
    if (marketplace !== undefined && marketplace !== null && !MARKETPLACES.includes(marketplace)) {
      res.status(400).json({ error: "invalid marketplace" });
      return;
    }

    const task = await taskRepository.update(req.params.id, { assignee, status, taskType, marketplace });

    // Every status change is announced back to the group it came from, not
    // just "done" — the client wants visibility into the whole pipeline.
    if (status !== undefined) {
      const whatsapp = resolveAdapterForSource(task.source, channels);
      await whatsapp.sendMessage(
        task.sourceRef,
        `Task: ${task.description}\nUpdate: ${statusLabel(status, task.marketplace)}`
      );
    }

    res.json(task);
  });

  return router;
}
