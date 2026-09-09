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

  // Deleting them would leave these clients' incoming tasks arriving
  // unassigned again, with nothing on any screen to say why.
  it("refuses deleting someone who still holds clients, and names them", () => {
    const why = whyEmployeeCannotBeDeleted({
      isSelf: false,
      targetIsActiveAdmin: false,
      otherActiveAdmins: 2,
      clientsAssigned: ["Alpha Traders", "Beta Retail"],
    });
    expect(why).toContain("Alpha Traders");
    expect(why).toContain("Beta Retail");
    expect(why).toContain("Clients screen");
  });

  it("reads as one client rather than several when it is one", () => {
    const why = whyEmployeeCannotBeDeleted({
      isSelf: false,
      targetIsActiveAdmin: false,
      otherActiveAdmins: 2,
      clientsAssigned: ["Gamma Store"],
    });
    expect(why).toContain("Gamma Store");
    expect(why).toContain("that client");
    expect(why).not.toContain("those clients");
  });

  // Somebody holding a dozen clients should get a sentence, not the whole
  // list — they only need enough to recognize where to go.
  it("summarizes rather than listing everything when there are many", () => {
    const why = whyEmployeeCannotBeDeleted({
      isSelf: false,
      targetIsActiveAdmin: false,
      otherActiveAdmins: 2,
      clientsAssigned: ["A", "B", "C", "D", "E", "F"],
    }) as string;
    expect(why).toContain("A, B, C and 3 other clients");
    expect(why).not.toContain("F");
  });

  // The ordinary case, and every caller that predates this column: nobody is
  // assigned to anybody, so nothing new refuses.
  it("allows deleting someone holding no clients", () => {
    expect(
      whyEmployeeCannotBeDeleted({
        isSelf: false,
        targetIsActiveAdmin: false,
        otherActiveAdmins: 1,
        clientsAssigned: [],
      })
    ).toBeNull();
  });

  // The two lock-out reasons come first — being told to reassign three
  // clients, then finding you still can't delete yourself, is two trips.
  it("says the lock-out reason first when both apply", () => {
    const why = whyEmployeeCannotBeDeleted({
      isSelf: false,
      targetIsActiveAdmin: true,
      otherActiveAdmins: 0,
      clientsAssigned: ["Alpha Traders"],
    });
    expect(why).toContain("only active admin");
  });
});
