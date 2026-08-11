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
- **Roles:** `admin` / `manager` / `member` on every employee. Only admins can add employees or use Settings; only admins and managers can see Clients or Reports, and only they can set a task's due date; task access otherwise (view/assign/status/type/marketplace) is open to any logged-in employee. Role is checked fresh from the DB on every request, not trusted from the session token, so a demotion takes effect immediately
- **Send Report — removed (2026-08-10).** It composed a metrics update by hand, one pasted row per product, and could attach a saved report link into the message. Every client now has a sheet linked, so Reports reads the figures instead of anyone pasting them, and two screens that both sent to clients was one too many to reason about. Saved report links went with it — the team confirmed none were in use — so `/api/report-links`, `reportLinkRepository`, the `api.ts` helpers and the `ReportLink` table are all gone. **The drop migration (`20260810131500_drop_report_links`) is not applied by deploying:** the Railway build runs `prisma generate`, never `prisma migrate deploy`, so it has to be run by hand against the live database, as every migration here has been.
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
- Reports → "Send to all" fails (the `whapi` channel is the `PeriskopeAdapter` — see `server.ts`, the key name is historical)
- `getChatName` returns undefined, so newly linked groups save with **no name** and show their raw JID in the UI

Evidence it's a plan change and not a long-standing bug: tasks logged on 24–25 July captured group names fine ("Test 3", "Test 1"), and the one from 23 July didn't. Restoring the Periskope plan should fix all of the above with no code change — `ensureGroupLinked` backfills a missing group name the next time a task comes in from that group.

This is also what blocks reading a group's **member list** to match a client against anyone in the group, rather than only against whoever posted.

## Security fix: "Deactivate" now actually locks people out (2026-07-30)

Deactivating an employee used to block only the **role-gated** screens (Clients, Employees, Settings, Reports). It did **not** block login, and it did not block anything behind `requireAuth` alone — a deactivated employee could still log in, read the entire task board, and edit tasks. Confirmed live before the fix: a deactivated member logged in (200), listed all 5 tasks, and successfully PATCHed one.

Two changes:

- **`routes/auth.ts`** — login rejects an inactive employee, worded identically to a wrong password so it doesn't leak which accounts exist.
- **`auth/requireAuth.ts`** — now looks the employee up fresh on every request and rejects them if missing or inactive, so deactivating ends an *existing* session immediately rather than whenever its cookie happens to expire. It stashes the row on `req.employee`, and `requireRole` reuses it, so role-gated routes don't fetch the same primary key twice.

## One WhatsApp message, one task

Periskope redelivers a message it hasn't had a quick answer about, and this
webhook answers only after doing everything: a second Periskope call for the
chat name, the task write, the "Got it, logged" reply, the assignee's alert.
Timed live at about five seconds, which was long enough — one message became
two identical tasks, two acknowledgements to the client and two alerts to the
assignee, five seconds apart. It was reaching real clients, not just tests:
any slow intake (cold process, Neon waking up, Periskope answering lazily)
did it.

`markMessageSeen` (services/seenMessages.ts) gates the handler on the
provider's message id, falling back to chat + sender + exact text if that
field is ever absent — dedupe quietly ceasing to work would look exactly like
the bug it prevents. A redelivery is answered 200 and dropped.

In memory rather than a table, deliberately: redeliveries arrive seconds after
the original so they land in the same process, and the alternative is a
database write per inbound message plus a migration. A redelivery straddling a
restart still gets through — the real cure for that is answering the webhook
sooner (reply once the task is written, then send the acknowledgement and the
alert), which is the fix to reach for if this recurs.

## Stage changes are announced to the client's group

Moving a task to any new stage messages that client's WhatsApp group at once,
not only "Done" as it used to. The proposal this system was bought on promises
the group is told every time a request's stage changes, and a client watching
for their request to move is the reason they tolerate the WhatsApp workflow at
all.

It fires only on a stage that actually moved: re-picking the same status, or
editing a due date, sends nothing. A client reading "status changed to
Submitted" about a task that was already Submitted learns nothing and trusts
the next message less. That rule is `shouldAnnounceStageChange` in
services/taskMessages.ts rather than a condition inline in the route — it
decides when a real person's phone buzzes, so it lives somewhere it is tested.

A successful send merges the status into the task's sent-snapshot so a later
manual Send doesn't restate it; a failed send leaves the snapshot alone, so
the change stays pending on the Send button instead of vanishing.

`DISABLE_AUTO_STATUS_UPDATES=true` switches it off without a deploy. This is
the one feature that messages a client on someone else's schedule, and a group
finding it noisy shouldn't have to wait for a release.

## Deleting tasks and employees

Both were missing, so a duplicate task or a test account stayed on the board
for the life of the system — found while cleaning up after live testing.

**Tasks:** `DELETE /api/tasks/:id`, admin and manager (matching who can delete
a client). Notes cascade with the task. Marking Done remains how finished work
is closed; this is for things that were never work.

**Employees:** `DELETE /api/employees/:id`, admin only, and refused in two
cases by `whyEmployeeCannotBeDeleted` (services/employeeDeletion.ts) — your own
account, and the last active admin. Both would end with somebody locked out of
their own system, so the rule is a tested pure function rather than a
condition buried in the route. Deactivating stays the right answer for someone
who has left: `Task.assignee` holds a name rather than a foreign key, so past
work keeps the name of whoever did it either way.

## Who sees which task

A **member sees only their own work**: tasks assigned to them, plus tasks
nobody has been put on yet (which anyone can pick up). Everything assigned to
someone else — a manager's or an admin's in particular — is off their board
entirely. Admins and managers go on seeing all of it, since triage means
looking at everyone's work.

The rule is one tested function, `services/taskVisibility.ts`, turned on the
**viewer's** role rather than the assignee's. Written the other way round
("hide tasks whose assignee is a manager") every request would have to re-read
the role behind every assignee name to answer the same question, and it would
still get a member's own work wrong the moment two people shared a name.

It is applied in the **query**, not after it (`taskRepository.list`), so hidden
rows never leave the database. Reaching a task by id is covered too — notes,
editing and sending all answer **404** for a task that isn't on your board,
the same answer as a wrong id, so "hidden from you" and "doesn't exist" can't
be told apart. Repeating tasks follow the same rule: a repeat set up for a
manager only ever produces tasks a member couldn't see anyway.

Unchanged: the daily reminder and the "a new task is yours" alert were always
per-person, and Clients / Client Details / Reports were already admin and
manager only.

## Database changes apply themselves on deploy

`startCommand` in `backend/railway.json` is `npx prisma migrate deploy && npm
start`. Until 11 Aug 2026 nothing in the deploy path applied a migration, so
every schema change needed someone to remember to run it by hand against the
live database — and forgetting once ships code whose tables don't exist yet,
which fails at runtime in a way that reads as random. Three migrations were in
fact sitting unapplied when this was noticed.

`migrate deploy` only applies migrations that haven't run, in order, and never
generates or edits one — so a redeploy with nothing new is a no-op. It runs
before the server starts, so a failed migration stops the release rather than
letting a half-migrated app serve requests.

**It still runs against the live database, because there is only one.** A
migration that drops or rewrites a column is irreversible the moment it
deploys, with no pause to look at it. Write those defensively: copy data
before dropping it, in the same migration.

## One report sheet per marketplace

`ClientReportSheet`. A client selling on both Amazon and Flipkart has two
separate sets of figures, and one sheet can't hold two accounts' numbers in
the same columns — so `Client.reportSheetUrl` became a row per marketplace,
linked from the Clients screen (`POST/DELETE /api/clients/:id/report-sheets`).
One sheet per marketplace per client, enforced by a unique index: a second
Amazon sheet is a mistake, not a second account.

**They send separately.** A client with two sheets appears twice on the
Reports screen — separate figures, separate ticks, separate message — and the
automatic round sends one message per sheet, five seconds apart. The heading
names the marketplace (`📊 *Performance Update (Flipkart) — August, Week 2*`)
**only when the client has more than one**, so every client who had a single
sheet before this change gets exactly the message they got before. As ever,
`composeReportMessage` and `composeMessage` in `WeeklyReports.tsx` must be
changed together.

**Nothing falls back.** A client with no Flipkart sheet gets no Flipkart
report — sending them Amazon figures headed "Flipkart" would be worse than
sending nothing. Asking for a preview without naming a marketplace works only
when the client has exactly one sheet; with several the route refuses rather
than guessing.

**The migration moved every existing sheet onto `amazon`** — all 19 linked so
far are Amazon trackers, confirmed before it ran. That step is in the same
migration as the `DROP COLUMN`, so it is the only chance to keep those links;
don't reorder it.

## Notes go out with the update, not on their own

A note ticked for the client no longer sends a WhatsApp message the moment
it's saved. It's marked (`TaskNote.sendToClient`) and waits, going out inside
the next update the task sends — the automatic stage-change message, or the
Send button. A client watching a request move should get one message about it,
not a status change followed a second later by a loose paragraph with no
context.

- **`sendToClient` is the intent, `sentAt` is the fact.** Until now ticking the
  box sent immediately, so "was it meant to go?" and "did it go?" were the same
  question. The thread shows all three states: Team only, Goes with next
  update, Sent to client ✓.
- **A note alone is reason enough to send.** With notes waiting and no field
  changed, the notes are the message — "we've chased Amazon again" is exactly
  what a client wants and needs no field to have moved. So the Send button also
  turns on for `hasNoteForClient`, or a note on a task nobody edits again could
  never reach anyone.
- **Marked sent only after the send returns.** A failed send leaves the notes
  pending so they ride along with the next attempt rather than being silently
  lost — the same rule the field snapshot already followed.
- Saving a note can no longer half-fail, so the screen no longer has to say
  "saved, but not sent".

## Marketplace and due date, read out of the message

`parser/taskDetails.ts`. **"task: listing not live on flipkart due 20/8"**
lands on the board already carrying both, instead of waiting for someone to
pick them from two dropdowns. Same principle as the tagged-number assignment:
the message is plain text on every channel, so this needs no provider-specific
mention data and works from a group, the official channel and Periskope alike.

**Marketplace** is matched against the **live option list**, so one an admin
adds in Settings is understood from the next message on with nothing to change
here. Whole words only — "amazon" in "amazonbasics" isn't a mention — and the
earliest one named wins, so "flipkart order rejected, not amazon" is Flipkart.
The generic **`other` option is skipped**: "waiting for other details" is
ordinary English, and reading it as a marketplace would be wrong far more often
than right.

**Due date** is introduced by `due`, `due date`, `deadline` or `by`, followed
by `20/8`, `20-08-2026`, `20.8.26`, `20 Aug`, `20th August 2026`, `Aug 20`,
`today` or `tomorrow`. **Day first**, as dates are written in India — 8/9 is 8
September. A two-digit year is this century. No year means this year, unless
that has already gone more than six months by, so "due 5/1" written in December
is next January rather than eleven months ago. A date that doesn't exist
(31/2) is ignored rather than rolled forward.

`by` only counts when a date-shaped value actually follows it, so "rejected by
amazon" and "sent by the client" set nothing. Dates are read **before** the
tagged-number match, so "20-08-2026" can't be picked over as a phone number
first. "today" is worked out in **India's own day** (fixed +5:30), not the
server's — Railway runs UTC, where a message sent at 2am India time falls on
the previous day and "due today" would arrive already overdue.

**The due-date phrase is cut out of the description** ("fix the listing, due
20 Aug" → "fix the listing"): it's a column now, and leaving it in would quote
it back to the client inside every update. **The marketplace word is left
where it is** — "due 20/8" is bookkeeping bolted onto a sentence, but "listing
not live on flipkart" *is* the sentence.

Nothing here can invent a value: an unrecognized marketplace or an unreadable
date simply isn't set, and the task looks exactly as it did before. The
acknowledgement now repeats back what was read — **"✅ Got it, logged —
Flipkart, due 20 Aug 2026."** — because a date understood wrongly is only
catchable by the person who typed it, and they are never going to open the
dashboard to check.

## Raising a task by hand

`POST /api/tasks`, admin and manager — the same two roles that can set a due
date or a repeat. **New task** on the board takes what the task is, the
client, the platform, the type, the employee and the due date on one form, so
a task doesn't have to be created and then triaged in five separate edits.

The **client picked is what decides where its updates go back to**: their
linked WhatsApp group (stored exactly as intake would have stored it, so Send
and the automatic stage messages work on it like any other task), or their
saved number if they have no group. With no client picked, the task is
internal — `source: "manual"` with nothing to send to, and its Send button is
off and says why rather than failing at the click. Picking an employee
messages them straight away, the same as assigning from the board.

## Filters and dropdowns on the board

- **Created and Due Date ranges** sit under the dropdowns. Both ends are
  optional — one box on its own reads as "everything up to" or "everything
  from". Days are compared in the **browser's own timezone**, not UTC: a task
  created at 8pm in India otherwise reports the day before and doesn't show up
  when you filter for the day you made it. A task with no due date is in no
  due-date range — asked for work due this week, "no due date" isn't an answer.
- **Every filter is now type-to-search** (`SearchableSelect`), like the row
  dropdowns already were, since these lists are admin-editable and only grow.
  The Client Details client picker too.
- **Fixed: options below the fold were unreachable.** The panel closes on
  scroll, because it's positioned from the trigger's on-screen position and a
  scroll makes that stale — but the listener is on the capture phase, so it
  also heard the option list's *own* scroll and closed the dropdown on the way
  down to anything past its 220px (roughly the first seven). A newly added
  option looked simply absent. Scrolls originating inside the panel are now
  ignored. Enter also takes the top match rather than only an only-match.

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
- **Sending by hand, to chosen clients** — the Reports screen is the manual path: pick the report, pick the date, tick the clients, Send. Ticking nobody sends to everyone whose sheet has numbers. A ticked client that can't be sent to is named under the button with the reason (no numbers, sheet unreadable, no group or phone saved) rather than quietly dropping out of the count — five ticked and "Send to 1" with nothing said was read as a bug in the screen.
- **Which day a daily report is about** (`DAILY_LOOK_BACK_DAYS`, `reportPeriod.ts`) — the last day **at or before** the chosen date that actually has figures, looking back up to a week. Sheets are filled in a day or two behind, since Amazon's own numbers arrive late, so reading only the chosen day found a blank row nearly every time and no daily report could go out at all. Never a later day: blank rows exist for the rest of the month and one going out as "today" would show a client an empty day as their account. The message is headed with the day the figures came from (`dailyDate`), never with today's date — in both the manual and the automatic path, which compose headings separately and must be changed together.
- **Three separate reports** — Daily, Weekly Sales and Weekly SKU, each reading its own tab of the client's sheet (`Daily`, `Weekly`, `SKU`). Pick one with the chips at the top of the Reports screen. The date chosen there decides the day a daily report reads and the week/month the others read (`?date=YYYY-MM-DD` on `/report-preview/:kind`), so a period already gone by can still be sent. Tab names are tried in a few likely spellings rather than relying on the Sheets API's range parsing being case-insensitive. The SKU tab is one row per SKU: it needs a column matching `/sku|asin|item|product/i`, and optional Month/Week columns to narrow to the current period — without them, every row is used.

**Not yet built (later phases / follow-ups):**
- End-to-end/integration tests against a real database (needs a provisioned Postgres instance)
- Self-service password reset by email (not needed yet at this team size — an admin sets a fresh password from the Employees screen, and the person changes it from My account)
