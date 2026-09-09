// Who a new task for a client belongs to, before anybody triages it.
//
// A client has one employee on them (Client.assignedEmployeeId). Every task
// created for that client is assigned to that person on the way in, so work
// arrives owned rather than sitting on the board unassigned until somebody
// opens the dashboard and picks a name.
//
// **This decides new work only.** Changing who a client is assigned to moves
// their next task, never the ones already on the board — those keep the
// assignee they have, whoever set it and however long ago. There is no
// backfill and deliberately so: an assignee on an existing task is a record
// of who has actually been working it, and rewriting a dozen of those from a
// dropdown would lose that with nothing to say it had happened.
//
// **Two things beat it**, both of them somebody saying so explicitly about
// this one task:
//
//   1. A number tagged in the incoming WhatsApp message ("task: fix the
//      listing @919876543210") — see parser/employeeMention.ts. That is an
//      instruction about this task, and an instruction is more specific than
//      a standing rule.
//   2. An employee picked on the "add task" form. Same reasoning: the person
//      making the task said who it is for.
//
// Neither is undone afterwards, and nothing here ever *replaces* an assignee
// that is already set — this only ever fills an empty one.
export interface AssignedEmployee {
  name: string;
  active: boolean;
}

export interface ClientWithAssignment {
  assignedEmployee?: AssignedEmployee | null;
}

export interface DefaultAssignment {
  // The employee name to put on the task, or null to leave it unassigned.
  // A name, not an id, because that is what Task.assignee holds — and it is
  // read fresh off the Employee row every time, so a rename carries over
  // without anything here needing to know.
  assignee: string | null;
  // Why there is no assignee, when there was somebody to consider. Null in
  // the ordinary "nobody is on this client" case, which is not worth logging.
  note: string | null;
}

// The rule, as a pure function so the awkward cases are covered by tests
// rather than by trusting three call sites to have been written the same way.
//
// An **inactive** employee is treated as nobody, and that is the one decision
// here worth reading twice. Somebody who has left keeps their name on the work
// they did, but new work must not pile onto them: assigned to a deactivated
// person, a task is invisible to every member on the board (a member sees
// their own work and unassigned work — see taskVisibility.ts), gets no "this
// is yours" alert and appears in no morning reminder, because both of those
// skip employees who are inactive. It would be work nobody could see. Left
// unassigned instead, it shows up for everyone as something to pick up, which
// is what an unowned task should look like.
export function defaultAssignmentFor(
  client: ClientWithAssignment | null | undefined
): DefaultAssignment {
  const employee = client?.assignedEmployee;
  if (!employee) return { assignee: null, note: null };

  if (!employee.active) {
    return {
      assignee: null,
      note:
        `${employee.name} is assigned to this client but is no longer active, ` +
        `so the task was left unassigned rather than given to somebody who cannot see it. ` +
        `Put someone else on the client from the Clients screen.`,
    };
  }

  return { assignee: employee.name, note: null };
}
