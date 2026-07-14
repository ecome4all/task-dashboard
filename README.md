# Task Dashboard (v2)

Replaces the Google Sheets task tracker. See `../PROPOSAL_V2.md` for the client-facing plan and `../TIME_AND_COST_ESTIMATION_V2.md` for internal effort/cost detail.

## Structure

- `backend/` — Express + TypeScript API. Receives WhatsApp webhooks, parses `task:` messages, stores tasks in Postgres via Prisma, serves the dashboard API, handles login sessions.
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
npx prisma db seed      # creates the first login, from SEED_ADMIN_EMAIL/SEED_ADMIN_PASSWORD
npm run dev
```

Runs on `http://localhost:4000`. Log into the dashboard with the `SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD` you set — there's no public sign-up route by design; add further employees from inside the dashboard once logged in (that only sets a name for the assignment dropdown, not a login — see `prisma/seed.ts` to grant login access to someone else).

### 3. Frontend

```
cd frontend
cp .env.example .env   # leave VITE_API_BASE_URL blank for local dev
npm install
npm run dev
```

Runs on `http://localhost:5173`, proxying `/api` to the backend.

### 4. Tests

```
cd backend
npm test
```

Covers the `task:` message parser, webhook payload extraction, and the auth service (password hashing, session signing) — all pure logic, no DB needed. Repositories and routes aren't covered by automated tests yet since there's no test database wired up in this environment; test those manually against a real Neon/Supabase instance before go-live.

## Deployment

- **Backend → Railway or Render.** `railway.json` and `render.yaml` are both included — pick one platform, not both. Set the env vars listed in `.env.example` in that platform's dashboard (`render.yaml` lists which ones need manual values vs. `generateValue: true` for `JWT_SECRET`).
- **Frontend → Vercel.** `vercel.json` is included. Set `VITE_API_BASE_URL` in Vercel's project settings to the deployed backend's URL.
- Once both are deployed, set the backend's `FRONTEND_URL` env var to the real Vercel URL (needed for CORS + cookies to work — see `src/server.ts`).
- Register the whapi.cloud webhook URL as `https://<your-backend>/webhook/whapi?secret=<WEBHOOK_SHARED_SECRET>` — the secret in the URL is what stops arbitrary internet requests from creating fake tasks, since this endpoint can't sit behind a login session.

## What's here vs. what's still needed

**Done:**
- Task schema (with `tenantId` on every row for future multi-tenant use, per the architecture discussion — not used yet, just present so it's a filter later, not a migration)
- `task:` message parser, with unit tests
- Webhook receiver with defensive payload extraction, with unit tests covering several plausible payload shapes (whapi.cloud's exact webhook shape isn't confirmed against this app yet — see the comment in `backend/src/parser/extractIncomingMessage.ts`; log real payloads during the Phase 2 pilot and tighten the extraction once confirmed)
- Auto-acknowledgement reply on task creation
- Dashboard: list tasks, assign from a real employee list, change status
- Employee management: add employees from the dashboard (`/api/employees`); dropdown is backed by the database, not a hardcoded list
- Login/auth: email+password sessions (httpOnly cookie, JWT-backed), `/api/tasks` and `/api/employees` require login, seed script creates the first login (no public sign-up endpoint, by design)
- Webhook route protected by a shared secret in the URL (whapi.cloud has no built-in request signing)
- WhatsApp adapter interface (`whatsappAdapter.ts`) so the Phase 3 official Cloud API integration is a second adapter, not a rewrite of the intake logic
- Deployment config for Railway, Render, and Vercel

**Not yet built (later phases / follow-ups):**
- Official WhatsApp Cloud API adapter (Phase 3)
- End-to-end/integration tests against a real database (needs a provisioned Postgres instance)
- Password reset flow (not needed yet at this team size — if someone's locked out, re-run the seed script or update their row directly)
- Per-employee roles/permissions — right now anyone who can log in can do anything; fine for a <5-person team, worth revisiting if that grows
