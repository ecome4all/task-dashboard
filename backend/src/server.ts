import "dotenv/config";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { createWebhookRouter } from "./routes/webhook";
import { createOfficialWebhookRouter } from "./routes/officialWebhook";
import { createPeriskopeWebhookRouter } from "./routes/periskopeWebhook";
import { createTasksRouter } from "./routes/tasks";
import { createEmployeesRouter } from "./routes/employees";
import { createReportLinksRouter } from "./routes/reportLinks";
import { createClientsRouter } from "./routes/clients";
import { createConfigOptionsRouter } from "./routes/configOptions";
import { createAuthRouter } from "./routes/auth";
import { requireAuth } from "./auth/requireAuth";
import { PeriskopeAdapter } from "./whatsapp/periskopeAdapter";
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
// `verify` captures the raw request body alongside express's parsed JSON —
// Periskope's webhook signature is an HMAC over the exact raw bytes, which
// re-serializing the parsed body isn't guaranteed to reproduce byte-for-byte.
app.use(
  express.json({
    verify: (req, _res, buf) => {
      (req as any).rawBody = buf;
    },
  })
);
app.use(cookieParser());

// The "whapi" key is a historical name — the group channel was originally
// meant to run on whapi.cloud, but that was never actually connected (no API
// key was ever issued), so it now runs on Periskope instead. Renaming the key
// itself would ripple into the "whapi" | "official" channel literal used
// across routes and the frontend for no real benefit, so it stays as-is.
// The official Cloud API channel runs alongside it indefinitely (see
// PROPOSAL_V2.md — moving existing clients off the group channel is the
// client's own call, not part of this project). Each adapter only knows how
// to send on its own channel — see resolveAdapter.ts for how a reply picks
// the right one.
const channels: WhatsAppChannels = {
  whapi: new PeriskopeAdapter(process.env.PERISKOPE_API_KEY ?? "", process.env.PERISKOPE_PHONE ?? ""),
  official: new CloudApiAdapter(
    process.env.WHATSAPP_CLOUD_API_TOKEN ?? "",
    process.env.WHATSAPP_CLOUD_PHONE_NUMBER_ID ?? ""
  ),
};

// Not behind requireAuth: WhatsApp calls these directly, not a logged-in
// browser. See the shared-secret/signature checks inside each router.
app.use("/webhook", createWebhookRouter(channels.whapi));
app.use("/webhook", createPeriskopeWebhookRouter(channels.whapi));
app.use("/webhook", createOfficialWebhookRouter(channels.official));

app.use("/api/auth", createAuthRouter());
app.use("/api/tasks", requireAuth, createTasksRouter(channels));
app.use("/api/employees", requireAuth, createEmployeesRouter());
app.use("/api/report-links", requireAuth, createReportLinksRouter(channels));
app.use("/api/clients", requireAuth, createClientsRouter(channels));
app.use("/api/config-options", requireAuth, createConfigOptionsRouter());

app.get("/health", (_req, res) => res.json({ ok: true }));

// Defense in depth: an unhandled rejection anywhere (a route missing a
// try/catch around an outbound WhatsApp send, for example — see tasks.ts,
// taskIntake.ts, reportLinks.ts, clients.ts for the actual fixes) otherwise
// crashes the entire Node process by default, taking the whole app down
// until Railway restarts it. Logging instead of crashing keeps one bad
// request from becoming a full outage.
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled promise rejection:", reason);
});

const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
