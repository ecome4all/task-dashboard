import { describe, it, expect } from "vitest";
import { statusLabel, composeSendUpdateMessage, changedFieldsSince, buildSnapshot } from "./taskMessages";

const STATUS_LABELS = { started: "Started", waiting_for_marketplace: "Waiting for Marketplace", done: "Done" };
const MARKETPLACE_LABELS = { flipkart: "Flipkart", amazon: "Amazon", meesho: "Meesho" };

describe("statusLabel", () => {
  it("substitutes the marketplace name into the waiting_for_marketplace label", () => {
    expect(statusLabel("waiting_for_marketplace", "flipkart", STATUS_LABELS, MARKETPLACE_LABELS)).toBe(
      "Waiting for Flipkart"
    );
  });

  it("falls back to a generic word when no marketplace is set yet", () => {
    expect(statusLabel("waiting_for_marketplace", null, STATUS_LABELS, MARKETPLACE_LABELS)).toBe(
      "Waiting for Marketplace"
    );
  });

  it("returns the plain label for any other status", () => {
    expect(statusLabel("done", null, STATUS_LABELS, MARKETPLACE_LABELS)).toBe("Done");
  });
});

describe("composeSendUpdateMessage", () => {
  const base = {
    description: "hello just testing",
    status: "done",
    marketplace: "meesho",
    assignee: "Test Member",
    dueDate: new Date("2026-07-25T00:00:00Z"),
    statusLabels: STATUS_LABELS,
    marketplaceLabels: MARKETPLACE_LABELS,
  };

  it("always names the task first, so a shared WhatsApp chat knows which task this is about", () => {
    const message = composeSendUpdateMessage({ ...base, fields: ["marketplace"] });
    expect(message).toBe('"hello just testing" — marketplace set to Meesho.');
  });

  it("phrases a status change as 'task status changed to'", () => {
    const message = composeSendUpdateMessage({ ...base, fields: ["status"] });
    expect(message).toBe('"hello just testing" — task status changed to Done.');
  });

  it("phrases a due date as 'due date set to'", () => {
    const message = composeSendUpdateMessage({ ...base, fields: ["dueDate"] });
    expect(message).toBe('"hello just testing" — due date set to 25 Jul 2026.');
  });

  it("phrases an assignee change as 'is now assigned to'", () => {
    const message = composeSendUpdateMessage({ ...base, fields: ["assignee"] });
    expect(message).toBe('"hello just testing" — is now assigned to Test Member.');
  });

  // Notes marked for the client used to be a WhatsApp message of their own,
  // sent the instant the note was saved. They now ride along with the update,
  // so a client gets one message about their request rather than a status
  // change followed a second later by a loose paragraph.
  it("carries a note along with the change it belongs to", () => {
    const message = composeSendUpdateMessage({
      ...base,
      fields: ["status"],
      notes: ["Amazon has the invoice, waiting on them."],
    });
    expect(message).toBe(
      '"hello just testing" — task status changed to Done.\n\nAmazon has the invoice, waiting on them.'
    );
  });

  it("carries several notes in the order they were written", () => {
    const message = composeSendUpdateMessage({
      ...base,
      fields: ["status"],
      notes: ["Raised with Amazon.", "They asked for the invoice."],
    });
    expect(message).toContain("Raised with Amazon.\nThey asked for the invoice.");
  });

  // A note is reason enough to message a client on its own — nothing about
  // the task itself has to have moved for "we've chased Amazon" to be worth
  // saying.
  it("sends the note by itself when no field changed", () => {
    const message = composeSendUpdateMessage({ ...base, fields: [], notes: ["We've chased Amazon again."] });
    expect(message).toBe('"hello just testing"\n\nWe\'ve chased Amazon again.');
  });

  // Nothing to say means nothing sent, rather than a bare task name.
  it("says nothing at all when there is neither a change nor a note", () => {
    expect(composeSendUpdateMessage({ ...base, fields: [] })).toBe("");
  });

  it("is unchanged for a task with no notes waiting", () => {
    expect(composeSendUpdateMessage({ ...base, fields: ["status"], notes: [] })).toBe(
      '"hello just testing" — task status changed to Done.'
    );
  });

  it("joins two fields with 'and'", () => {
    const message = composeSendUpdateMessage({ ...base, fields: ["marketplace", "assignee"] });
    expect(message).toBe('"hello just testing" — marketplace set to Meesho and is now assigned to Test Member.');
  });

  it("joins three or more fields with commas and 'and' before the last", () => {
    const message = composeSendUpdateMessage({ ...base, fields: ["marketplace", "assignee", "dueDate"] });
    expect(message).toBe(
      '"hello just testing" — marketplace set to Meesho, is now assigned to Test Member and due date set to 25 Jul 2026.'
    );
  });

  it("uses the dynamic waiting_for_marketplace label when status is included", () => {
    const message = composeSendUpdateMessage({
      ...base,
      status: "waiting_for_marketplace",
      fields: ["status"],
    });
    expect(message).toBe('"hello just testing" — task status changed to Waiting for Meesho.');
  });

  it("uses friendly fallback wording for unset fields", () => {
    const message = composeSendUpdateMessage({
      ...base,
      marketplace: null,
      assignee: null,
      dueDate: null,
      fields: ["marketplace", "assignee", "dueDate"],
    });
    expect(message).toBe(
      '"hello just testing" — marketplace set to not set, is now assigned to no one yet and due date set to Not set.'
    );
  });
});

describe("changedFieldsSince / buildSnapshot", () => {
  const task = {
    status: "done",
    marketplace: "flipkart",
    assignee: "Priya",
    dueDate: null as Date | null,
  };

  it("with no snapshot yet, reports every field that already has a value", () => {
    expect(changedFieldsSince(task, null)).toEqual(["status", "marketplace", "assignee"]);
  });

  it("skips fields that were never set (still null) even with no snapshot", () => {
    // dueDate is null above and correctly excluded from the previous
    // assertion — nothing to report on a field that's never had a real value.
    expect(changedFieldsSince(task, null)).not.toContain("dueDate");
  });

  it("reports nothing once the snapshot matches current values", () => {
    const snapshot = buildSnapshot(task);
    expect(changedFieldsSince(task, snapshot)).toEqual([]);
  });

  it("reports only the fields that actually changed since the snapshot", () => {
    const snapshot = buildSnapshot(task);
    const updated = { ...task, assignee: "Rahul" };
    expect(changedFieldsSince(updated, snapshot)).toEqual(["assignee"]);
  });

  it("reports a newly-set field that was previously unset", () => {
    const snapshot = buildSnapshot(task);
    const updated = { ...task, dueDate: new Date("2026-07-25T00:00:00Z") };
    expect(changedFieldsSince(updated, snapshot)).toEqual(["dueDate"]);
  });

  it("never reports status while it's still sitting at the default 'started' -- nothing's actually happened yet", () => {
    const freshTask = { status: "started", marketplace: "amazon", assignee: "Jayvant", dueDate: null as Date | null };
    expect(changedFieldsSince(freshTask, null)).toEqual(["marketplace", "assignee"]);
  });

  it("does start reporting status once it moves off the default, even on the first-ever send", () => {
    const freshTask = { status: "waiting_for_marketplace", marketplace: "amazon", assignee: null, dueDate: null as Date | null };
    expect(changedFieldsSince(freshTask, null)).toEqual(["status", "marketplace"]);
  });
});
