import "dotenv/config";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { createWebhookRouter } from "./routes/webhook";
import { createTasksRouter } from "./routes/tasks";
import { createEmployeesRouter } from "./routes/employees";
import { createAuthRouter } from "./routes/auth";
import { requireAuth } from "./auth/requireAuth";
import { WhapiAdapter } from "./whatsapp/whapiAdapter";

const app = express();
app.use(
  cors({
    origin: process.env.FRONTEND_URL ?? "http://localhost:5173",
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());

const whatsapp = new WhapiAdapter(
  process.env.WHAPI_API_KEY ?? "",
  process.env.WHAPI_BASE_URL ?? "https://gate.whapi.cloud"
);

// Not behind requireAuth: WhatsApp calls this directly, not a logged-in browser.
// See the shared-secret check inside the router itself.
app.use("/webhook", createWebhookRouter(whatsapp));

app.use("/api/auth", createAuthRouter());
app.use("/api/tasks", requireAuth, createTasksRouter(whatsapp));
app.use("/api/employees", requireAuth, createEmployeesRouter());

app.get("/health", (_req, res) => res.json({ ok: true }));

const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
