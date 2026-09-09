-- One employee owns a client's work.
--
-- Until now a task arriving from a client's WhatsApp group landed on the board
-- with no assignee at all, and stayed there until somebody opened the
-- dashboard and picked a name off a dropdown. Who a given client belongs to
-- was knowledge held by the team rather than by the system, so nothing could
-- act on it: not intake, not the "a new task is yours" alert, not the 9am
-- reminder, which only ever knew about work already bearing your name.
--
-- This column is where that knowledge goes. From here on, a new task for a
-- client with somebody on it arrives already assigned to them.
--
-- A link to Employee, not a copy of the name. Task.assignee holds a name
-- because a task is a record of what happened and has to keep the name of
-- whoever did it even after they leave; this is a live pointer at a current
-- member of staff, and it must follow them through a rename. The name is
-- read off the Employee row at the moment each task is made.
--
-- Null on every existing row, which is correct and needs no backfill: a
-- client nobody has been put on behaves exactly as all 23 of them did
-- yesterday. Nothing already on the board changes either — this decides who
-- new work goes to, never who old work belonged to.
ALTER TABLE "Client" ADD COLUMN "assignedEmployeeId" TEXT;

CREATE INDEX "Client_assignedEmployeeId_idx" ON "Client"("assignedEmployeeId");

-- ON DELETE RESTRICT, so deleting an employee who still holds clients fails
-- rather than quietly emptying the column on each of them — that would stop
-- those clients' tasks being assigned to anyone, with nothing on any screen
-- to say why. The delete route checks first and answers with the names; this
-- is the backstop for a race between the check and the delete.
ALTER TABLE "Client" ADD CONSTRAINT "Client_assignedEmployeeId_fkey"
    FOREIGN KEY ("assignedEmployeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
