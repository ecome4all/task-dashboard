import "dotenv/config";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { createPeriskopeWebhookRouter } from "./routes/periskopeWebhook";
import { createTasksRouter } from "./routes/tasks";
import { createEmployeesRouter } from "./routes/employees";
import { createClientsRouter } from "./routes/clients";
import { createConfigOptionsRouter } from "./routes/configOptions";
import { createDiagnosticsRouter } from "./routes/diagnostics";
import { createAuthRouter } from "./routes/auth";
import { createBackupRouter } from "./routes/backup";
import { requireAuth } from "./auth/requireAuth";
import { PeriskopeAdapter } from "./whatsapp/periskopeAdapter";
import { WhatsAppChannels } from "./whatsapp/resolveAdapter";
import { createRecurringTasksRouter } from "./routes/recurringTasks";
import { startScheduler } from "./services/scheduler";

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

// Periskope is the only WhatsApp channel — see resolveAdapter.ts.
const channels: WhatsAppChannels = {
  periskope: new PeriskopeAdapter(process.env.PERISKOPE_API_KEY ?? "", process.env.PERISKOPE_PHONE ?? ""),
};

// Not behind requireAuth: Periskope calls this directly, not a logged-in
// browser. See the signature check inside the router.
app.use("/webhook", createPeriskopeWebhookRouter(channels));

app.use("/api/auth", createAuthRouter());
app.use("/api/tasks", requireAuth, createTasksRouter(channels));
app.use("/api/employees", requireAuth, createEmployeesRouter());
app.use("/api/clients", requireAuth, createClientsRouter(channels));
app.use("/api/config-options", requireAuth, createConfigOptionsRouter());
app.use("/api/recurring-tasks", requireAuth, createRecurringTasksRouter());
// Admin-only, and read-only: reports why a report sheet won't read when the
// answer is on the host rather than in the sheet. See routes/diagnostics.ts.
app.use("/api/diagnostics", requireAuth, createDiagnosticsRouter());
// Not behind requireAuth: fetched weekly by an Apps Script in the client's
// Google account, guarded by BACKUP_TOKEN instead. See routes/backup.ts.
app.use("/api/backup", createBackupRouter());

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

// Creates repeating tasks when they fall due and sends the daily employee
// reminder. In-process rather than an external cron: Railway already keeps
// this one long-lived process alive, and everything the scheduler does is
// driven by stored timestamps, so a restart never loses or duplicates work.
// Set DISABLE_SCHEDULER=true to turn it off (e.g. if a second instance is
// ever run alongside this one).
startScheduler(channels);

const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
