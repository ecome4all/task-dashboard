import { describe, it, expect } from "vitest";
import { whyEmployeeCannotBeDeleted } from "./employeeDeletion";

describe("whyEmployeeCannotBeDeleted", () => {
  it("allows deleting an ordinary person", () => {
    expect(
      whyEmployeeCannotBeDeleted({ isSelf: false, targetIsActiveAdmin: false, otherActiveAdmins: 1 })
    ).toBeNull();
  });

  // Mid-session, this would log the admin out of a system they may be the
  // only one holding the password to.
  it("refuses deleting yourself", () => {
    const why = whyEmployeeCannotBeDeleted({ isSelf: true, targetIsActiveAdmin: true, otherActiveAdmins: 3 });
    expect(why).toContain("your own account");
  });

  // The one that would end the client's access to their own system.
  it("refuses deleting the last active admin", () => {
    const why = whyEmployeeCannotBeDeleted({
      isSelf: false,
      targetIsActiveAdmin: true,
      otherActiveAdmins: 0,
    });
    expect(why).toContain("only active admin");
  });

  it("allows deleting an admin while another one remains", () => {
    expect(
      whyEmployeeCannotBeDeleted({ isSelf: false, targetIsActiveAdmin: true, otherActiveAdmins: 1 })
    ).toBeNull();
  });

  // A deactivated admin isn't holding the door open for anyone, so the
  // last-admin rule doesn't apply to them.
  it("allows deleting a deactivated admin even if no active admin remains", () => {
    expect(
      whyEmployeeCannotBeDeleted({ isSelf: false, targetIsActiveAdmin: false, otherActiveAdmins: 0 })
    ).toBeNull();
  });

  // Self is checked first: telling someone "make another admin first" when
  // the real problem is that it's their own account would send them off to
  // do something that wouldn't help.
  it("says the more useful of the two reasons when both apply", () => {
    const why = whyEmployeeCannotBeDeleted({ isSelf: true, targetIsActiveAdmin: true, otherActiveAdmins: 0 });
    expect(why).toContain("your own account");
  });
});
