import { describe, it, expect } from "vitest";
import { defaultAssignmentFor } from "./clientAssignment";

describe("defaultAssignmentFor", () => {
  it("gives the task to the employee the client is assigned to", () => {
    const { assignee, note } = defaultAssignmentFor({
      assignedEmployee: { name: "Asha", active: true },
    });
    expect(assignee).toBe("Asha");
    expect(note).toBeNull();
  });

  // The ordinary state of every client until somebody is put on them, and of
  // all 23 of them the day this shipped. Unassigned is a perfectly good
  // answer — it is what the board did before this existed.
  it("leaves the task unassigned when nobody is on the client", () => {
    expect(defaultAssignmentFor({ assignedEmployee: null })).toEqual({ assignee: null, note: null });
    expect(defaultAssignmentFor({})).toEqual({ assignee: null, note: null });
  });

  // A task with no client at all — created on the board without picking one.
  it("leaves the task unassigned when there is no client", () => {
    expect(defaultAssignmentFor(null)).toEqual({ assignee: null, note: null });
    expect(defaultAssignmentFor(undefined)).toEqual({ assignee: null, note: null });
  });

  // The case worth having a test for: assigned to a deactivated person, a
  // task is invisible to every member on the board, gets no "this is yours"
  // alert and shows in no morning reminder. Unassigned, everyone can see it
  // and pick it up.
  it("leaves the task unassigned when the client's employee has been deactivated", () => {
    const { assignee, note } = defaultAssignmentFor({
      assignedEmployee: { name: "Bharat", active: false },
    });
    expect(assignee).toBeNull();
    expect(note).toContain("Bharat");
    expect(note).toContain("no longer active");
  });

  // Nobody-on-the-client is normal and silent; an inactive assignee is a
  // misconfiguration somebody has to fix, so only that one says anything.
  it("only explains itself when there was somebody to consider", () => {
    expect(defaultAssignmentFor({ assignedEmployee: null }).note).toBeNull();
    expect(defaultAssignmentFor({ assignedEmployee: { name: "Gone", active: false } }).note).not.toBeNull();
  });
});
