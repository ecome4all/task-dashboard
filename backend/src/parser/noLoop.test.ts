import { describe, it, expect } from "vitest";
import { parseTaskMessage } from "./taskParser";
import { composeSendUpdateMessage, composeNoteMessage } from "../services/taskMessages";
import { composeRepeatReminder } from "../services/repeatReminder";

// extractPeriskopeMessage no longer filters `from_me`, so every message this
// app sends into a group comes straight back through the webhook. If any of
// them parsed as a task it would loop forever: task -> ack -> task -> ack.
describe("our own outbound messages must never read as a task", () => {
  it("the intake acknowledgement does not", () => {
    expect(parseTaskMessage("✅ Got it, logged.")).toBeNull();
  });

  it("a status-update message does not", () => {
    const message = composeSendUpdateMessage({
      description: "Optimise Ads",
      fields: ["status", "marketplace", "assignee", "dueDate"],
      status: "done",
      marketplace: "amazon",
      assignee: "Kinjal Patel",
      dueDate: new Date("2026-08-10"),
      statusLabels: { done: "Done" },
      marketplaceLabels: { amazon: "Amazon" },
    });
    expect(parseTaskMessage(message)).toBeNull();
  });

  it("a note sent to the group does not", () => {
    expect(parseTaskMessage(composeNoteMessage("Optimise Ads", "Done, ACOS is down to 22%"))).toBeNull();
  });

  // The sharpest case for notes: someone types a note that itself begins with
  // "task:". The note body is pasted straight into the message, so only the
  // emoji and quoted description in front of it stop a loop.
  it("a note whose text itself starts with 'task:' does not", () => {
    expect(parseTaskMessage(composeNoteMessage("Optimise Ads", "task: please also check Flipkart"))).toBeNull();
  });

  // The reminder a repeat sends instead of creating a second copy of work
  // that is still open. Same danger as the note above: the task's own wording
  // is pasted straight in, so a task whose text begins with "task:" is the
  // case that would loop.
  it("a repeat's 'still open' reminder does not, even quoting a task that starts with 'task:'", () => {
    const message = composeRepeatReminder(
      "Jayvant",
      {
        description: "task: this looks like a prefix",
        clientName: "Homzo India",
        status: "started",
        dueDate: null,
        createdAt: new Date("2026-08-12T09:00:00Z"),
      },
      { started: "Started" },
      new Date("2026-08-19T09:00:00Z")
    );
    expect(parseTaskMessage(message)).toBeNull();
  });

  // The dangerous case: a task whose own text begins with "task:" gets quoted
  // back inside the update message. It must still not re-parse as a new task.
  it("a status update about a task whose description itself starts with 'task:' does not", () => {
    const message = composeSendUpdateMessage({
      description: "task: this looks like a prefix",
      fields: ["status"],
      status: "done",
      marketplace: null,
      assignee: null,
      dueDate: null,
      statusLabels: { done: "Done" },
      marketplaceLabels: {},
    });
    expect(parseTaskMessage(message)).toBeNull();
  });
});
