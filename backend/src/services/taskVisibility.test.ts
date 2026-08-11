import { describe, it, expect } from "vitest";
import { taskVisibilityFor, isTaskVisible } from "./taskVisibility";

const admin = { id: "1", name: "Jayvant", role: "admin", active: true };
const manager = { id: "2", name: "Shivani", role: "manager", active: true };
const member = { id: "3", name: "Kinjal", role: "member", active: true };

describe("taskVisibilityFor", () => {
  it("puts no limit on an admin or a manager", () => {
    expect(taskVisibilityFor(admin)).toBeNull();
    expect(taskVisibilityFor(manager)).toBeNull();
  });

  it("limits a member to their own name", () => {
    expect(taskVisibilityFor(member)).toEqual({ ownName: "Kinjal" });
  });

  // The rule this whole module exists for: a member's board must not carry
  // work that belongs to a manager.
  it("hides a manager's task from a member", () => {
    const visibility = taskVisibilityFor(member);
    expect(isTaskVisible({ assignee: "Shivani" }, visibility)).toBe(false);
    expect(isTaskVisible({ assignee: "Jayvant" }, visibility)).toBe(false);
  });

  it("shows a member their own work and anything nobody is on yet", () => {
    const visibility = taskVisibilityFor(member);
    expect(isTaskVisible({ assignee: "Kinjal" }, visibility)).toBe(true);
    expect(isTaskVisible({ assignee: null }, visibility)).toBe(true);
  });

  // Another member's work is somebody else's work — same answer as a
  // manager's, so the board only ever shows one person their own.
  it("hides another member's task", () => {
    expect(isTaskVisible({ assignee: "Someone Else" }, taskVisibilityFor(member))).toBe(false);
  });

  it("shows an admin everything", () => {
    const visibility = taskVisibilityFor(admin);
    expect(isTaskVisible({ assignee: "Shivani" }, visibility)).toBe(true);
    expect(isTaskVisible({ assignee: null }, visibility)).toBe(true);
  });

  // A role nobody wrote a rule for, or no session employee at all, must not
  // be handed the whole board by default.
  it("fails closed on an unknown role or a missing employee", () => {
    expect(taskVisibilityFor({ id: "4", name: "New Role", role: "auditor", active: true })).toEqual({
      ownName: "New Role",
    });
    expect(taskVisibilityFor(undefined)).toEqual({ ownName: "" });
    expect(isTaskVisible({ assignee: "Shivani" }, taskVisibilityFor(undefined))).toBe(false);
  });
});
