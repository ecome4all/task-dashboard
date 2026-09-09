// Why an employee may not be deleted, or null when it's allowed.
//
// Deleting is the irreversible cousin of deactivating. Two of the three ways
// it can go wrong end with somebody locked out of their own system: an admin
// removing themselves mid-session, or removing the last person who could have
// put anyone back. The third is quieter and does not lock anyone out — it
// strands the clients whose incoming work was set to land on this person, so
// their tasks silently go back to arriving unassigned. Deactivating has none
// of the three, which is why it stays the default and this is the exception.
//
// A pure function so the dangerous cases are covered by tests rather than by
// trusting that the route was written correctly.
export function whyEmployeeCannotBeDeleted(input: {
  isSelf: boolean;
  targetIsActiveAdmin: boolean;
  otherActiveAdmins: number;
  // Clients whose new tasks are set to land on this person, by name. Empty
  // for anyone nobody has been put on, which is the ordinary case.
  clientsAssigned?: string[];
}): string | null {
  if (input.isSelf) {
    return "You can't delete your own account. Ask another admin to do it.";
  }
  if (input.targetIsActiveAdmin && input.otherActiveAdmins === 0) {
    return "This is the only active admin. Make someone else an admin first, or nobody will be able to manage the system.";
  }

  // Last of the three, because it is the only one with a fix that takes a
  // minute rather than a decision: the other two say something is wrong with
  // deleting this person at all, this one says there is tidying to do first.
  //
  // The clients are named rather than counted. "3 clients are assigned to
  // them" leaves an admin opening 23 rows to find which three, and the whole
  // point of refusing instead of quietly clearing the column is that somebody
  // decides where that work goes next.
  const assigned = input.clientsAssigned ?? [];
  if (assigned.length > 0) {
    return (
      `New tasks for ${formatList(assigned)} are set to go to this person. ` +
      `Put someone else on ${assigned.length === 1 ? "that client" : "those clients"} ` +
      `on the Clients screen first, then delete them. ` +
      `(Deactivating them instead works right now and keeps their name on the work they have done.)`
    );
  }

  return null;
}

// "A", "A and B", "A, B and C" — and past four, the first three and a count,
// so somebody holding a dozen clients gets a sentence rather than a paragraph
// they have to scroll.
function formatList(names: string[]): string {
  if (names.length === 1) return names[0];
  if (names.length <= 4) return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `${names.slice(0, 3).join(", ")} and ${names.length - 3} other clients`;
}
