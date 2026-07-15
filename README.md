# Task Dashboard (v2)

Replaces the Google Sheets task tracker. See `../PROPOSAL_V2.md` for the client-facing plan and `../TIME_AND_COST_ESTIMATION_V2.md` for internal effort/cost detail.

## Structure

- `backend/` — Express + TypeScript API. Receives WhatsApp webhooks (both the whapi.cloud group channel and the official Cloud API channel), parses `task:` messages, stores tasks in Postgres via Prisma, serves the dashboard API, handles login sessions and roles.
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

33 tests, covering: the `task:` message parser, both webhook payload extractors (whapi.cloud and official Cloud API), the auth service (password hashing, session signing), the `requireRole` permission check, the shared task-intake handler, the channel-resolver that picks the right WhatsApp adapter to reply on, and the report-link message composer. All pure logic with mocked dependencies where needed — no DB required. Repositories and routes themselves aren't covered by automated tests yet since there's no test database wired up in this environment; test those manually against a real Neon/Supabase instance before go-live.

## Deployment

- **Backend → Railway or Render.** `railway.json` and `render.yaml` are both included — pick one platform, not both. Set the env vars listed in `.env.example` in that platform's dashboard (`render.yaml` lists which ones need manual values vs. `generateValue: true` for `JWT_SECRET`).
- **Frontend → Vercel.** `vercel.json` is included. Set `VITE_API_BASE_URL` in Vercel's project settings to the deployed backend's URL.
- Once both are deployed, set the backend's `FRONTEND_URL` env var to the real Vercel URL (needed for CORS + cookies to work — see `src/server.ts`).
- **whapi.cloud webhook:** register `https://<your-backend>/webhook/whapi?secret=<WEBHOOK_SHARED_SECRET>` — the secret in the URL is what stops arbitrary internet requests from creating fake tasks, since this endpoint can't sit behind a login session.
- **Official Cloud API webhook:** register `https://<your-backend>/webhook/official` in the Meta App Dashboard, with the verify token set to `WHATSAPP_VERIFY_TOKEN`. Meta calls this URL with a `GET` once to confirm you control it before it'll deliver real messages.

## What's here vs. what's still needed

**Done:**
- Task schema (with `tenantId` on every row for future multi-tenant use, per the architecture discussion — not used yet, just present so it's a filter later, not a migration)
- `task:` message parser, with unit tests
- **Two WhatsApp channels, both wired up:**
  - whapi.cloud (group channel) — webhook receiver with defensive payload extraction (its exact webhook shape isn't confirmed against this app yet — see the comment in `backend/src/parser/extractIncomingMessage.ts`; log real payloads during the Phase 2 pilot and tighten the extraction once confirmed), protected by a shared secret in the webhook URL
  - Official WhatsApp Cloud API (1:1 channel) — webhook receiver with exact parsing (Meta's payload shape is documented and stable) plus the `hub.challenge` verification handshake
  - A reply always goes out on the *same* channel a task came in on (`whatsapp/resolveAdapter.ts`) — a group task can't be answered via the official API and vice versa
- Auto-acknowledgement reply on task creation, on whichever channel it arrived on
- Dashboard: list tasks, assign from a real employee list, change status
- Employee management: admins add employees from the dashboard (`/api/employees`); dropdown is backed by the database, not a hardcoded list
- Login/auth: email+password sessions (httpOnly cookie, JWT-backed), `/api/tasks`, `/api/employees`, and `/api/report-links` require login
- **Roles:** `admin` / `supervisor` / `member` on every employee. Only admins can add new employees; only admins and supervisors can see/use Report Links; task access (view/assign/status) is open to any logged-in employee. Role is checked fresh from the DB on every request, not trusted from the session token, so a demotion takes effect immediately
- **Report Links:** the client's reports live in spreadsheets they maintain themselves (e.g. Google Sheets) — this app never reads or writes their contents. Admins/supervisors save a description + link in the dashboard's "Reports" view, then send it to a client over WhatsApp (either channel) with one click. Deliberately not a live data sync or an embedded spreadsheet — see the conversation this came out of for why that was ruled out.
- Deployment config for Railway, Render, and Vercel

**Not yet built (later phases / follow-ups):**
- End-to-end/integration tests against a real database (needs a provisioned Postgres instance)
- Password reset flow (not needed yet at this team size — if someone's locked out, re-run the seed script or update their row directly)
- Tightening the whapi.cloud payload parser once a real webhook payload has actually been captured (currently best-effort/defensive, per the comment in the code)
