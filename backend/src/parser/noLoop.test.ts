import { describe, it, expect } from "vitest";
import { parseTaskMessage } from "./taskParser";
import { composeSendUpdateMessage, composeNoteMessage } from "../services/taskMessages";

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
