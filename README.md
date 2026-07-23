# Task Dashboard (v2)

Replaces the Google Sheets task tracker. See `../Official Whatsapp API/PROPOSAL_V2.md` for the client-facing plan and `../Official Whatsapp API/TIME_AND_COST_ESTIMATION_V2.md` for internal effort/cost detail.

## Structure

- `backend/` — Express + TypeScript API. Receives WhatsApp webhooks (both the Periskope group channel and the official Cloud API channel), parses `task:` messages, stores tasks in Postgres via Prisma, serves the dashboard API, handles login sessions and roles.
- `frontend/` — React + Vite dashboard. Login screen, then lists tasks, assigns them, marks them done.

## Local setup

### 1. Database

Create a free Postgres database (Neon or Supabase) and copy its connection string.

### 2. Backend

```
cd backend
cp .env.example .env   # fill in DATABASE_URL, JWT_SECRET, SEED_ADMIN_* — see comments in .env.example
npm install
npx prisma migrate dev --name init
npx prisma db seed      # creates the first login (role: admin), from SEED_ADMIN_EMAIL/SEED_ADMIN_PASSWORD
npm run dev
```

Runs on `http://localhost:4000`. Log into the dashboard with the `SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD` you set — there's no public sign-up route by design. That first account is an **admin**; admins can add further employees from inside the dashboard (that only sets a name for the assignment dropdown and defaults to the **member** role — not a login; see `prisma/seed.ts` to grant login access, and update an employee's `role` column directly to promote someone to admin).

### 3. Frontend

```
cd frontend
cp .env.example .env   # leave VITE_API_BASE_URL blank for local dev
npm install
npm run dev
```

Runs on `http://localhost:5190` (pinned in `vite.config.ts` — avoids colliding with other locally-running projects' dev servers, which happened during development; don't change this back to a random port without reason).

### 4. Tests

```
cd backend
npm test
```

48 tests, covering: the `task:` message parser, both webhook payload extractors (Periskope and official Cloud API), Periskope's webhook signature verification, the auth service (password hashing, session signing), the `requireRole` permission check, the shared task-intake handler, and the channel-resolver that picks the right WhatsApp adapter to reply on. All pure logic with mocked dependencies where needed — no DB required. Repositories and routes themselves aren't covered by automated tests yet since there's no test database wired up in this environment; test those manually against a real Neon/Supabase instance before go-live.

## Deployment

**Live now:**
- Frontend: `https://tasks.ecom4all.in` (custom domain, a subdomain on the client's own `ecom4all.in` — the root domain has an unrelated existing business site, don't touch that) — aliased to the Vercel project, still reachable at its original `https://frontend-sigma-one-11.vercel.app` too
- Backend (Railway): `https://task-dashboard-production-7d35.up.railway.app`

Both are on the `ecome4all` Railway/Vercel/GitHub accounts, deployed from `github.com/ecome4all/task-dashboard`.

- **Backend → Railway.** `railway.json` in this repo configures the build. Env vars are set directly on the Railway service (Variables tab) — see `.env.example` for the full list. **Important:** the build command explicitly uses `npm install --include=dev`, not plain `npm install` — with `NODE_ENV=production` set (required for the secure-cookie fix below), npm skips devDependencies by default, which breaks the build since `tsc` lives there. Don't "simplify" this back to a plain install.
- **Frontend → Vercel.** `vercel.json` proxies `/api/*` to the Railway backend (a Vercel rewrite), so the browser only ever talks to `tasks.ecom4all.in` directly — `VITE_API_BASE_URL` must be **blank** in Vercel's project env vars (a redeploy is needed after changing it, since it's baked in at build time). This isn't just tidiness: when the frontend called the Railway URL directly, the session cookie was a cross-site cookie from the browser's point of view, and some browsers (seen live: desktop Chrome/Edge for at least one real user) block or drop that kind of cookie entirely — login would succeed, then immediately bounce back with "session expired" because the cookie never actually got stored. Routing through the same origin makes it an ordinary first-party cookie, which isn't subject to that at all. Don't repoint `VITE_API_BASE_URL` back at the Railway URL directly without re-introducing this bug.
- Railway's `FRONTEND_URL` is set to the real Vercel URL — required for CORS + the session cookie's `SameSite=None` to work (see `src/auth/authService.ts` — the cookie is `SameSite=None; Secure` in production since frontend and backend are on different domains, and `SameSite=Lax` locally since both run on `localhost` there).
- **Railway approval gate:** deployments triggered by a GitHub account that isn't a member of the Railway workspace/team require manual approval in the Railway dashboard before they'll build. This will keep happening on every push unless the pushing account is added as a proper Railway team member (not just a GitHub repo collaborator).
- **Repo is public.** Vercel's Hobby (free) plan blocks deploys triggered by a commit author without contributing access on the project, for *private* repos — the fix without paying for Pro is keeping this repo public, which is why it is. If it's ever made private again, deploys from a non-owner account will start failing with "Deployment Blocked" until either Pro is purchased or the repo goes public again.
- **Git integration can silently be disconnected.** If pushes stop producing new Vercel deployments, check Project Settings → Git first — reconnecting doesn't retroactively deploy past commits, and neither does clicking "Redeploy" on an already-blocked deployment (it replays that deployment's cached decision). A fresh commit is what actually re-triggers a real build.
- **Periskope webhook (group channel):** register `https://task-dashboard-production-7d35.up.railway.app/webhook/periskope` in Periskope Settings → Webhooks, with the signing secret set to `PERISKOPE_WEBHOOK_SECRET`. Unlike whapi.cloud, there's no secret in the URL — Periskope signs each POST with an HMAC-SHA256 of the raw body in the `x-periskope-signature` header, verified in `backend/src/routes/periskopeWebhook.ts`.
- **Official Cloud API webhook:** register `https://task-dashboard-production-7d35.up.railway.app/webhook/official` in the Meta App Dashboard, with the verify token set to `WHATSAPP_VERIFY_TOKEN`. Meta calls this URL with a `GET` once to confirm you control it before it'll deliver real messages.
- **Handing the group channel over to the client:** the group channel is tied to whatever WhatsApp number is connected in Periskope (`PERISKOPE_PHONE`) and whichever Periskope account/API key owns that connection. For a real handover, the client should get their **own** Periskope account (not keep using ai4work's) — create it, connect their WhatsApp number there, then update `PERISKOPE_API_KEY`, `PERISKOPE_PHONE`, and `PERISKOPE_WEBHOOK_SECRET` in Railway's Variables tab (a plain number swap under the same account only needs `PERISKOPE_PHONE` updated). Either way, **existing WhatsApp groups were joined using the old number** — sending into a group requires the connected number to actually be a member of it, so the new number needs to be added to every group you want task-logging to keep working in. 1:1 chats aren't affected (they're keyed by the client's own number, not the org's).

## What's here vs. what's still needed

**Done:**
- Task schema (with `tenantId` on every row for future multi-tenant use, per the architecture discussion — not used yet, just present so it's a filter later, not a migration)
- `task:` message parser, with unit tests
- **Two WhatsApp channels, both wired up:**
  - Periskope (group channel) — webhook receiver (`backend/src/routes/periskopeWebhook.ts`) with HMAC signature verification (`x-periskope-signature`), confirmed against real traffic rather than just Periskope's docs — see `backend/src/parser/extractPeriskopeMessage.ts` and the standalone `periskope-integration` package (sibling folder, outside this repo) for the specifics and the gotchas that don't match Periskope's own documentation examples (event field is `event_type` not `event`; a text message's `message_type` is `"chat"` not `"text"`; a chat's display name isn't on the message webhook at all, only on a separate `GET /v1/chats` call)
  - Official WhatsApp Cloud API (1:1 channel) — webhook receiver with exact parsing (Meta's payload shape is documented and stable) plus the `hub.challenge` verification handshake
  - A reply always goes out on the *same* channel a task came in on (`whatsapp/resolveAdapter.ts`) — a group task can't be answered via the official API and vice versa
- Auto-acknowledgement reply on task creation, on whichever channel it arrived on
- Client gating on task intake: an incoming `task:` message only becomes a real Task if its chat_id (or, in a group, the individual sender's phone) is already tied to an active Client — otherwise it's logged to `UnrecognizedMessage` instead, visible on the Clients page for staff to review and link
- Dashboard: paginated task list (10/page), clickable status filter chips (with live counts) to narrow the list to one status, a per-client summary panel (total/pending/done), assign from a real employee list, change status/marketplace/type via a searchable dropdown, set a due date (admin/manager only — members can edit everything else on a task but not this, enforced server-side too)
- **Settings:** Marketplace, Status, and Task Type are admin-editable lists (`ConfigOption` model, `/api/config-options`) instead of hardcoded — add/rename/deactivate options from the Settings tab without a code change. `waiting_for_marketplace` still gets its dynamic "Waiting for <marketplace>" label from whatever that marketplace option's current label is.
- Employee management: admins add employees from the dashboard (`/api/employees`); dropdown is backed by the database, not a hardcoded list
- Client management: admins/managers add clients, link a client to the WhatsApp group its tasks come from, edit phone/name, deactivate/reactivate
- Login/auth: email+password sessions (httpOnly cookie, JWT-backed); every `/api/*` route below `/api/auth` requires login
- **Roles:** `admin` / `manager` / `member` on every employee. Only admins can add employees or use Settings; only admins and managers can see Clients or Send Report, and only they can set a task's due date; task access otherwise (view/assign/status/type/marketplace) is open to any logged-in employee. Role is checked fresh from the DB on every request, not trusted from the session token, so a demotion takes effect immediately
- **Send Report:** one combined screen — compose a metrics update (ad spend, orders, ACOS, etc., auto-calculating the derived percentages) with a live WhatsApp-formatted preview, optionally attach a saved report link (the client's own spreadsheet, e.g. a Google Sheet this app never reads/writes) into that same message, then send it in one action. A saved link's "last sent" timestamp updates once the combined send succeeds.
- Crash safety: every outbound WhatsApp send (status-update notification, task-intake ack, report send) is wrapped so a failed send can't crash the whole backend process, plus a process-level `unhandledRejection` handler as a backstop — this was a real production incident (see git history for `tasks.ts`/`taskIntake.ts`/`clients.ts`/`reportLinks.ts`), not a hypothetical
- Deployment config for Railway and Vercel

**Not yet built (later phases / follow-ups):**
- End-to-end/integration tests against a real database (needs a provisioned Postgres instance)
- Password reset flow (not needed yet at this team size — if someone's locked out, re-run the seed script or update their row directly)
