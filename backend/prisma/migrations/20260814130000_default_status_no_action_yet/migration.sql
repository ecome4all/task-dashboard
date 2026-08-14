-- A new task arrives having had nothing done to it. The default was
-- "started", which claimed work had begun on every WhatsApp message the
-- moment it landed, and left no status meaning "somebody has actually picked
-- this up" — every task looked started from the second it existed.
--
-- "started" stays a status, now meaning what it says. Existing rows are left
-- exactly as they are: there is no way to tell, after the fact, which of them
-- were genuinely being worked on and which were only sitting at the old
-- default, and quietly rewriting a status that staff have been reading off
-- the board would be worse than leaving the old wording in place.
ALTER TABLE "Task" ALTER COLUMN "status" SET DEFAULT 'no_action_yet';

-- The status dropdown is built from ConfigOption rows, so the new default has
-- to exist as one or the board shows the raw value "no_action_yet" and the
-- dropdown has no entry to change it back to.
--
-- Done here rather than in prisma/seed.ts because the deploy runs
-- `prisma migrate deploy` and does NOT run the seed (see railway.json) — the
-- column default and the option it names have to arrive together or the board
-- is broken in between. seed.ts lists it too, for a database built from
-- scratch.
--
-- The existing statuses shift down one so this sits first, which is where the
-- start of the workflow belongs. `id` is a plain text primary key with no
-- database default (Prisma generates cuids in the application), so a fixed
-- readable one is supplied.
UPDATE "ConfigOption" SET "sortOrder" = "sortOrder" + 1
WHERE "category" = 'status' AND "tenantId" = 'default';

INSERT INTO "ConfigOption" ("id", "tenantId", "category", "value", "label", "sortOrder", "active")
VALUES ('seed_status_no_action_yet', 'default', 'status', 'no_action_yet', 'No Action Yet', 0, true)
ON CONFLICT ("tenantId", "category", "value") DO NOTHING;
