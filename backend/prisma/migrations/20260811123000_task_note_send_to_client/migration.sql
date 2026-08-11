-- A note marked for the client no longer sends a WhatsApp message of its own.
-- It waits, and goes out as part of the next update the task sends — a client
-- watching a request move should get one message about it, not a status
-- change followed by a loose paragraph.
--
-- "sentAt" already recorded when a note reached the client. This adds the
-- intent behind it, which was never stored: until now, ticking the box sent
-- the note immediately, so "was it meant to go?" and "did it go?" were the
-- same question.

ALTER TABLE "TaskNote" ADD COLUMN "sendToClient" BOOLEAN NOT NULL DEFAULT false;

-- Every note already sent was, by definition, one meant for the client — the
-- old code had no other way to set sentAt. Marking them keeps the thread
-- reading correctly ("sent to the client") instead of showing them as notes
-- that were never meant to go.
UPDATE "TaskNote" SET "sendToClient" = true WHERE "sentAt" IS NOT NULL;
