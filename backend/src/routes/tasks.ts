import { Router } from "express";
import { taskRepository } from "../repositories/taskRepository";
import { WhatsAppChannels, resolveAdapterForSource } from "../whatsapp/resolveAdapter";

export function createTasksRouter(channels: WhatsAppChannels) {
  const router = Router();

  router.get("/", async (_req, res) => {
    const tasks = await taskRepository.list();
    res.json(tasks);
  });

  router.patch("/:id", async (req, res) => {
    const { assignee, status } = req.body;
    const task = await taskRepository.update(req.params.id, { assignee, status });

    if (status === "done") {
      const whatsapp = resolveAdapterForSource(task.source, channels);
      await whatsapp.sendMessage(task.sourceRef, `✅ Task done: ${task.description}`);
    }

    res.json(task);
  });

  return router;
}
