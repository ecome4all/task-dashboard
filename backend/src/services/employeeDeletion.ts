// Why an employee may not be deleted, or null when it's allowed.
//
// Deleting is the irreversible cousin of deactivating, and the two ways it
// can go wrong both end with somebody locked out of their own system: an
// admin removing themselves mid-session, or removing the last person who
// could have put anyone back. Deactivating has neither problem, which is why
// it stays the default and this is the exception.
//
// A pure function so the dangerous cases are covered by tests rather than by
// trusting that the route was written correctly.
export function whyEmployeeCannotBeDeleted(input: {
  isSelf: boolean;
  targetIsActiveAdmin: boolean;
  otherActiveAdmins: number;
}): string | null {
  if (input.isSelf) {
    return "You can't delete your own account. Ask another admin to do it.";
  }
  if (input.targetIsActiveAdmin && input.otherActiveAdmins === 0) {
    return "This is the only active admin. Make someone else an admin first, or nobody will be able to manage the system.";
  }
  return null;
}
