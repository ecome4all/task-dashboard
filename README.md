# Task Dashboard (v2)

Replaces the Google Sheets task tracker. See `../PROPOSAL_V2.md` for the client-facing plan and `../TIME_AND_COST_ESTIMATION_V2.md` for internal effort/cost detail.

## Structure

- `backend/` — Express + TypeScript API. Receives WhatsApp webhooks, parses `task:` messages, stores tasks in Postgres via Prisma, serves the dashboard API.
- `frontend/` — React + Vite dashboard. Lists tasks, assigns them, marks them done.

## Local setup

### 1. Database

Create a free Postgres database (Neon or Supabase) and copy its connection string.

### 2. Backend

```
cd backend
cp .env.example .env   # fill in DATABASE_URL, and WHAPI_API_KEY once you have one
npm install
npx prisma migrate dev --name init
npm run dev
```

Runs on `http://localhost:4000`.

### 3. Frontend

```
cd frontend
npm install
npm run dev
```

Runs on `http://localhost:5173`, proxying `/api` to the backend.

### 4. Tests

```
cd backend
npm test
```

Covers the `task:` message parser and the webhook payload extraction — both pure logic, no DB needed. Everything downstream of the database (repositories, routes) isn't covered by automated tests yet since there's no test database wired up in this environment; test those manually against a real Neon/Supabase instance before go-live.

## What's here vs. what's still needed

**Done:**
- Task schema (with `tenantId` on every row for future multi-tenant use, per the architecture discussion — not used yet, just present so it's a filter later, not a migration)
- `task:` message parser, with unit tests
- Webhook receiver with defensive payload extraction, with unit tests covering several plausible payload shapes (whapi.cloud's exact webhook shape isn't confirmed against this app yet — see the comment in `backend/src/parser/extractIncomingMessage.ts`; log real payloads during the Phase 2 pilot and tighten the extraction once confirmed)
- Auto-acknowledgement reply on task creation
- Dashboard: list tasks, assign from a real employee list, change status
- Employee management: add employees from the dashboard (`/api/employees`); dropdown is now backed by the database, not a hardcoded list
- WhatsApp adapter interface (`whatsappAdapter.ts`) so the Phase 3 official Cloud API integration is a second adapter, not a rewrite of the intake logic

**Not yet built (later phases / follow-ups):**
- Official WhatsApp Cloud API adapter (Phase 3)
- End-to-end/integration tests against a real database (needs a provisioned Postgres instance)
- Auth/login for the dashboard
- Deployment config for Railway/Render (backend) and Vercel/Netlify (frontend)
