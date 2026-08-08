# Task Dashboard (v2)

Replaces the Google Sheets task tracker. Tasks arrive as WhatsApp messages, get triaged on a dashboard, and updates go back out to the client on the same channel they came in on.

## What's on GitHub

**This repo is public** (see the Vercel note under Deployment for why). Only the application itself belongs here — code, config templates, and this README. Nothing client-confidential, commercial, or credential-bearing.

Never committed, and must stay that way:

| Not published | Why |
|---|---|
| `LOGIN.txt` | real dashboard passwords — gitignored at the repo root |
| `backend/.env`, `frontend/.env` | live database URL, API keys, JWT secret. Only `.env.example` (empty placeholders) is tracked |
| `../Official Whatsapp API/` | client proposals and internal effort/cost estimates — ai4work commercial detail |
| `../files recvd/` | client-supplied spreadsheets, logos and screenshots |
| `../periskope-integration/` | separate package, its own concern |

Two rules follow from the repo being public:

- **Don't reference internal or sibling-folder documents from this README.** A `../` path is a dead link to anyone who clones, and naming an internal cost document tells the world it exists. This README previously linked the proposal and cost-estimate files that way; it no longer does.
- **Secrets live in the host's dashboard, never in a file here** — Railway's Variables tab for the backend, Vercel's project env vars for the frontend.

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

Runs on `http://localhost:4000`. Log into the dashboard with the `SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD` you set — there's no public sign-up route by design. That first account is an **admin**; everything after it is done from inside the dashboard (see Employees and logins below).

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

220 tests, covering: the `task:` message parser, both webhook payload extractors (Periskope and official Cloud API), Periskope's webhook signature verification, the auth service (password hashing, session signing), the `requireRole` permission check, the shared task-intake handler (including the group auto-link), the channel-resolver that picks the right WhatsApp adapter to reply on, the repeat-schedule maths, the employee reminder composer, the tagged-number-to-employee matcher, the assignment alert, the email/password rules used when giving someone a login, the scheduled report round's config reading, due-check and message wording, and the service-account key reshaping. All pure logic with mocked dependencies where needed — no DB required. Repositories and routes themselves aren't covered by automated tests yet since there's no test database wired up in this environment; test those manually against a real Neon/Supabase instance before go-live.

## Deployment

**Live now:**
- Frontend: `https://tasks.ecom4all.in` (custom domain, a subdomain on the client's own `ecom4all.in` — the root domain has an unrelated existing business site, don't touch that) — aliased to the Vercel project, still reachable at its original `https://frontend-sigma-one-11.vercel.app` too
- Backend (Railway): `https://task-dashboard-production-7d35.up.railway.app`

Both are on the `ecome4all` Railway/Vercel/GitHub accounts, deployed from `github.com/ecome4all/task-dashboard`.

- **Backend runs in Singapore (`asia-southeast1-eqsg3a`), set as `deploy.region` in `railway.json`.** It was originally deployed to US West, which put it on the far side of the Pacific from both its users and — more expensively — its database: Neon is in `ap-southeast-1`, so every single query was a round trip across an ocean, several times per request. Everyone who uses this system is in India. Don't move it back to a US region without moving the database too.
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
- **Automatic group linking:** when a `task:` message arrives from a WhatsApp group that isn't linked to anyone yet, but the *sender's own phone* matches a client, that group is saved to that client there and then (`clientRepository.ensureGroupLinked`). From that point on every other member of the group — the client's staff, colleagues — is recognized too, so nobody ever has to find and copy a raw group JID by hand. Deliberately **never reassigns**: a group already linked (by hand or by an earlier message) stays where it is, so a group can't silently move to another client because someone else posted in it. The one thing it will update on an existing link is filling in a missing group name. Best-effort — if the link fails, the task is still created
- Dashboard: paginated task list (10/page), clickable status filter chips (with live counts) to narrow the list to one status, a per-client summary panel (total/pending/done), assign from a real employee list, change status/marketplace/type via a searchable dropdown, set a due date (admin/manager only — members can edit everything else on a task but not this, enforced server-side too)
- **Settings:** Marketplace, Status, and Task Type are admin-editable lists (`ConfigOption` model, `/api/config-options`) instead of hardcoded — add/rename/deactivate options from the Settings tab without a code change. `waiting_for_marketplace` still gets its dynamic "Waiting for <marketplace>" label from whatever that marketplace option's current label is.
- Employee management: admins add employees from the dashboard (`/api/employees`); dropdown is backed by the database, not a hardcoded list
- Client management: admins/managers add clients, link a client to the WhatsApp group its tasks come from, edit phone/name, deactivate/reactivate
- **Client Details:** one screen with everything about a single client — headline counts (all work / still open / done / past due date / no employee / average days to finish), a work-by-status breakdown bar, contact + linked WhatsApp groups + report sheet, free-text team notes (the only place `Client.notes` is editable), a per-employee breakdown, this week's live sheet numbers, and their full task history with status filters. Reached from the sidebar or by clicking a name on the Clients list. Note the join: a `Task` has no `clientId`, only the client's *name* as it was at intake, so `taskRepository.listForClient` also matches on the client's linked group ids and their phone (last 10 digits of `sourceRef`) — otherwise renaming a client would silently hide all their older work
- Login/auth: email+password sessions (httpOnly cookie, JWT-backed); every `/api/*` route below `/api/auth` requires login
- **Roles:** `admin` / `manager` / `member` on every employee. Only admins can add employees or use Settings; only admins and managers can see Clients or Send Report, and only they can set a task's due date; task access otherwise (view/assign/status/type/marketplace) is open to any logged-in employee. Role is checked fresh from the DB on every request, not trusted from the session token, so a demotion takes effect immediately
- **Send Report:** one combined screen — compose a metrics update (ad spend, orders, ACOS, etc., auto-calculating the derived percentages) with a live WhatsApp-formatted preview, optionally attach a saved report link (the client's own spreadsheet, e.g. a Google Sheet this app never reads/writes) into that same message, then send it in one action. A saved link's "last sent" timestamp updates once the combined send succeeds.
- Crash safety: every outbound WhatsApp send (status-update notification, task-intake ack, report send) is wrapped so a failed send can't crash the whole backend process, plus a process-level `unhandledRejection` handler as a backstop — this was a real production incident (see git history for `tasks.ts`/`taskIntake.ts`/`clients.ts`/`reportLinks.ts`), not a hypothetical
- Deployment config for Railway and Vercel

## ⚠️ Periskope API is currently returning 401 (checked 2026-07-30)

Every outbound call to `api.periskope.app` fails with:

```
401 {"code":"UNAUTHORIZED_ERROR","message":"APIs available only for active pro and enterprise plans."}
```

The account's plan has lapsed or downgraded — this is not a code or credentials problem. **Incoming webhooks still work** (Periskope pushes those to us; they aren't an API call we make), so tasks still get logged. Everything we *send* is broken:

- No `✅ Got it, logged.` acknowledgement on task intake
- No automatic "done" status notification back to the group
- Send Report and Weekly Reports → "Send All" both fail (the `whapi` channel is the `PeriskopeAdapter` — see `server.ts`, the key name is historical)
- `getChatName` returns undefined, so newly linked groups save with **no name** and show their raw JID in the UI

Evidence it's a plan change and not a long-standing bug: tasks logged on 24–25 July captured group names fine ("Test 3", "Test 1"), and the one from 23 July didn't. Restoring the Periskope plan should fix all of the above with no code change — `ensureGroupLinked` backfills a missing group name the next time a task comes in from that group.

This is also what blocks reading a group's **member list** to match a client against anyone in the group, rather than only against whoever posted.

## Security fix: "Deactivate" now actually locks people out (2026-07-30)

Deactivating an employee used to block only the **role-gated** screens (Clients, Employees, Settings, Reports). It did **not** block login, and it did not block anything behind `requireAuth` alone — a deactivated employee could still log in, read the entire task board, and edit tasks. Confirmed live before the fix: a deactivated member logged in (200), listed all 5 tasks, and successfully PATCHed one.

Two changes:

- **`routes/auth.ts`** — login rejects an inactive employee, worded identically to a wrong password so it doesn't leak which accounts exist.
- **`auth/requireAuth.ts`** — now looks the employee up fresh on every request and rejects them if missing or inactive, so deactivating ends an *existing* session immediately rather than whenever its cookie happens to expire. It stashes the row on `req.employee`, and `requireRole` reuses it, so role-gated routes don't fetch the same primary key twice.

## Employees and logins

An **employee row is not a login.** "Add employee" creates somebody who can be given tasks, picked in the assignee dropdown and messaged on WhatsApp — with no email, no password, and no way to sign in. Giving them one is a separate, deliberate step, and there is no public sign-up route anywhere in the app.

- **Give login / Change** on the Employees screen (admin-only, `PUT /api/employees/:id/login`) sets the email and first password together. Both halves at once on purpose: there's no password-reset email in this app, so changing only one of them could leave someone unable to get in with nobody able to fix it. The password is shown back to the admin **once**, to pass on in person — nothing emails or WhatsApps it, since a password sitting in a chat thread is readable by anyone who later picks up that phone.
- **Remove** (`DELETE /api/employees/:id/login`) takes sign-in access away and leaves the person in place — they keep their name, their tasks and their WhatsApp messages. An admin can't remove their own (server-enforced), same as the existing self-demotion guard; deactivating is the thing that stops everything at once.
- **My account → Change my password** (`POST /api/auth/change-password`, any role) is where the person replaces the password an admin knows with one only they know. The current password is required even though the session already proves who they are — that's what stops a browser left logged in from becoming a permanent takeover.
- Emails are stored and looked up **lower-case** (`normalizeEmail`), so capitals can't create a second account for one person or break their login. `hasLogin` on the employee API is a computed boolean — `passwordHash` is read to derive it and never leaves the server.
- **Known limit:** sessions are signed JWTs with no revocation list, so changing a password does not end sessions already issued on other devices; they run until they expire (7 days). Deactivating the employee *does* end them immediately, since `requireAuth` re-reads the row on every request.

## Scheduled reports — sent to clients automatically

Off unless `REPORT_SEND_ENABLED=true`. When on, the scheduler sends the
configured report to every active client with a sheet linked, on a fixed day
and hour, **5 seconds apart** (`SEND_GAP_MS` — WhatsApp throttles a burst of
similar messages from one number, and losing the account costs more than the
round taking a minute longer).

Config is environment variables, not a table: the timetable is identical for
every client, so a `ReportSchedule` row would have had one row with values
that never vary. `REPORT_SEND_KIND`, `REPORT_SEND_DAY` (0–6 or `every`),
`REPORT_SEND_HOUR`, alongside the existing `REMINDER_HOUR`. A bad day value
falls back to Monday rather than to every day — a wrong value that sends
weekly is a smaller mistake than one that sends seven times a week.

Most of the code is about *not* sending. A client is skipped, not messaged,
when their sheet has no figures for the period, when it can't be opened, or
when there's no group and no phone to send to. An empty report is worse than a
late one: the client reads it as the state of their account.

Afterwards every admin and manager gets one summary — sent to whom, what
failed, what was skipped and why. That message is the only evidence the round
happened, since the reports went to clients rather than to staff; without it a
total failure is indistinguishable from a quiet week.

`composeReportMessage` deliberately mirrors `composeMessage` in
`frontend/src/WeeklyReports.tsx` so a client can't tell an automatic report
from a hand-sent one — change both together. The run marker is held in memory
(a restart inside the scheduled hour could send twice; accepted, since the
window is one hour of one day) and the day key is the **local** date, because
a Monday 10:00 round keyed off UTC fires on Sunday evening India time.

## Renaming an employee

`PATCH /api/employees/:id` accepts `name`, and the Employees screen has an editable name box. This is not a plain column update: `Task.assignee` and `RecurringTask.assignee` store the employee's **name as text**, not an id, so changing only the `Employee` row would leave all their work pointing at a name that belongs to nobody — still showing the old name, and no longer matching any option in the assignee dropdown. `employeeRepository.rename` updates all three in one transaction, and a rename that would collide with another employee's name is rejected with 409 (case-insensitively), since two people sharing a name makes assignment unanswerable.

## Notes, repeating tasks, reminders and the three reports

- **Notes on a task** (`TaskNote`) — a running log rather than one shared box: every note keeps who wrote it and when, so several people working the same task over days don't overwrite each other's context. Open the "Notes" button on any task row and the thread appears underneath it. Any logged-in employee can read and add; only the author or an admin can delete (enforced server-side, not just hidden). The board shows a count per row and only loads a thread when a row is actually opened.
- **Repeating tasks** (`RecurringTask`) — "Repeat this" on any task (admin/manager) copies it into a standalone repeat set to daily/weekly/monthly. It's a **copy, not a reference**: editing, completing or deleting the original afterwards changes nothing about what the repeat produces. Triage (employee/type/marketplace) is carried across, so a repeat doesn't come back stripped. Manage them on the **Repeating Tasks** screen. First run is always one interval out, so setting up a weekly repeat doesn't instantly duplicate the task you're looking at.
- **Daily employee reminder** — one WhatsApp message per employee at `REMINDER_HOUR` (default 9am) listing their own open work, grouped Late / Due today / Still open. Employees with no phone saved, or nothing open, are skipped rather than sent an empty message. Set an employee's number on the **Employees** screen.
- **"A new task is yours" alert** (`services/assignmentNotice.ts`) — the moment a task is put on someone, they get a WhatsApp message naming the task, the client and the due date, instead of finding out at tomorrow's reminder. Fires from all three places an assignment happens: the assignee dropdown on the board, a number tagged in an incoming message (below), and a repeating task falling due. Only on an actual change of hands — re-picking the same person, or editing another field on a task they already own, sends nothing. Best-effort throughout: the assignment is saved first and a WhatsApp failure is logged, never thrown. Employees with no number saved, and deactivated ones, are skipped.
- **Assigning by tagging a number** (`parser/employeeMention.ts`) — "task: fix the listing @919876543210" arrives already assigned. WhatsApp writes a tagged person into the message body as their number, so this works on every channel without provider-specific mention data, and hand-typed numbers (`+91 98765 43210`, or without the country code) work the same way. The number is matched against saved employee numbers on the last 10 digits, so an order id, a date, or a client tagging their own colleague changes nothing; the matched number is then dropped from the description so it doesn't end up on the board or quoted back to the client. The employee table is only queried for messages that contain something number-shaped.
- **Scheduler** (`services/scheduler.ts`) — in-process, ticking every 5 minutes; no external cron. Everything is driven by stored timestamps (`nextRunAt`), so a restart or redeploy never loses or duplicates work, and a backend that was down for a week catches up with **one** run rather than replaying every missed one. `DISABLE_SCHEDULER=true` turns it off — needed only if a second instance is ever run alongside this one.
- **Three separate reports** — Daily, Weekly Sales and Weekly SKU, each reading its own tab of the client's sheet (`Daily`, `Weekly`, `SKU`). Pick one with the chips at the top of the Reports screen. Tab names are tried in a few likely spellings rather than relying on the Sheets API's range parsing being case-insensitive. The SKU tab is one row per SKU: it needs a column matching `/sku|asin|item|product/i`, and optional Month/Week columns to narrow to the current period — without them, every row is used.

**Not yet built (later phases / follow-ups):**
- End-to-end/integration tests against a real database (needs a provisioned Postgres instance)
- Self-service password reset by email (not needed yet at this team size — an admin sets a fresh password from the Employees screen, and the person changes it from My account)
