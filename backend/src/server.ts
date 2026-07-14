import "dotenv/config";
import express from "express";
import cors from "cors";
import { createWebhookRouter } from "./routes/webhook";
import { createTasksRouter } from "./routes/tasks";
import { WhapiAdapter } from "./whatsapp/whapiAdapter";

const app = express();
app.use(cors());
app.use(express.json());

const whatsapp = new WhapiAdapter(
  process.env.WHAPI_API_KEY ?? "",
  process.env.WHAPI_BASE_URL ?? "https://gate.whapi.cloud"
);

app.use("/webhook", createWebhookRouter(whatsapp));
app.use("/api/tasks", createTasksRouter(whatsapp));

app.get("/health", (_req, res) => res.json({ ok: true }));

const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
