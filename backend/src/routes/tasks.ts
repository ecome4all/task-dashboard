import { Router } from "express";
import { taskRepository } from "../repositories/taskRepository";
import { WhatsAppChannels, resolveAdapterForSource } from "../whatsapp/resolveAdapter";

const STATUSES = ["started", "submitted", "waiting_for_amazon_client", "again_submitted", "done"];
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

    if (status === "done") {
      const whatsapp = resolveAdapterForSource(task.source, channels);
      await whatsapp.sendMessage(task.sourceRef, `✅ Task done: ${task.description}`);
    }

    res.json(task);
  });

  return router;
}
