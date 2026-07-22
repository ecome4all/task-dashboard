import "dotenv/config";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { createWebhookRouter } from "./routes/webhook";
import { createOfficialWebhookRouter } from "./routes/officialWebhook";
import { createTasksRouter } from "./routes/tasks";
import { createEmployeesRouter } from "./routes/employees";
import { createReportLinksRouter } from "./routes/reportLinks";
import { createClientsRouter } from "./routes/clients";
import { createAuthRouter } from "./routes/auth";
import { requireAuth } from "./auth/requireAuth";
import { WhapiAdapter } from "./whatsapp/whapiAdapter";
import { CloudApiAdapter } from "./whatsapp/cloudApiAdapter";
import { WhatsAppChannels } from "./whatsapp/resolveAdapter";

const app = express();

// FRONTEND_URL can be a comma-separated list — lets the same backend serve
// logins from more than one frontend URL at once (e.g. a nicer *.vercel.app
// alias alongside the original auto-generated one), without breaking either.
const allowedOrigins = (process.env.FRONTEND_URL ?? "http://localhost:5190")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      // No Origin header (curl, server-to-server calls) — nothing to check against.
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());

// Both channels run side by side indefinitely (see PROPOSAL_V2.md — moving
// existing clients off the group channel is the client's own call, not part
// of this project). Each adapter only knows how to send on its own channel —
// see resolveAdapter.ts for how a reply picks the right one.
const channels: WhatsAppChannels = {
  whapi: new WhapiAdapter(
    process.env.WHAPI_API_KEY ?? "",
    process.env.WHAPI_BASE_URL ?? "https://gate.whapi.cloud"
  ),
  official: new CloudApiAdapter(
    process.env.WHATSAPP_CLOUD_API_TOKEN ?? "",
    process.env.WHATSAPP_CLOUD_PHONE_NUMBER_ID ?? ""
  ),
};

// Not behind requireAuth: WhatsApp calls these directly, not a logged-in
// browser. See the shared-secret check (whapi) and hub.verify_token check
// (official) inside each router.
app.use("/webhook", createWebhookRouter(channels.whapi));
app.use("/webhook", createOfficialWebhookRouter(channels.official));

app.use("/api/auth", createAuthRouter());
app.use("/api/tasks", requireAuth, createTasksRouter(channels));
app.use("/api/employees", requireAuth, createEmployeesRouter());
app.use("/api/report-links", requireAuth, createReportLinksRouter(channels));
app.use("/api/clients", requireAuth, createClientsRouter(channels));

app.get("/health", (_req, res) => res.json({ ok: true }));

const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
