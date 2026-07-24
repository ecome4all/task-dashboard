import { describe, it, expect } from "vitest";
import { statusLabel, composeSendUpdateMessage } from "./taskMessages";

const STATUS_LABELS = { started: "Started", waiting_for_marketplace: "Waiting for Marketplace", done: "Done" };
const MARKETPLACE_LABELS = { flipkart: "Flipkart", amazon: "Amazon" };
const TASK_TYPE_LABELS = { listing: "Listing" };

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
    description: "Fix listing price for SKU123",
    status: "done",
    marketplace: "flipkart",
    taskType: "listing",
    assignee: "Priya",
    dueDate: new Date("2026-07-25T00:00:00Z"),
    createdAt: new Date("2026-07-20T00:00:00Z"),
    statusLabels: STATUS_LABELS,
    marketplaceLabels: MARKETPLACE_LABELS,
    taskTypeLabels: TASK_TYPE_LABELS,
  };

  it("reads as one sentence for a single field", () => {
    const message = composeSendUpdateMessage({ ...base, fields: ["marketplace"] });
    expect(message).toBe("Update on task: Fix listing price for SKU123.\nMarketplace is Flipkart.");
  });

  it("joins two fields with 'and'", () => {
    const message = composeSendUpdateMessage({ ...base, fields: ["marketplace", "assignee"] });
    expect(message).toBe("Update on task: Fix listing price for SKU123.\nMarketplace is Flipkart and assigned to Priya.");
  });

  it("joins three or more fields with commas and 'and' before the last", () => {
    const message = composeSendUpdateMessage({ ...base, fields: ["marketplace", "assignee", "dueDate"] });
    expect(message).toBe(
      "Update on task: Fix listing price for SKU123.\nMarketplace is Flipkart, assigned to Priya and due by 25 Jul 2026."
    );
  });

  it("uses the dynamic waiting_for_marketplace label when status is included", () => {
    const message = composeSendUpdateMessage({
      ...base,
      status: "waiting_for_marketplace",
      fields: ["status"],
    });
    expect(message).toBe("Update on task: Fix listing price for SKU123.\nStatus is Waiting for Flipkart.");
  });

  it("uses friendly fallback wording for unset fields", () => {
    const message = composeSendUpdateMessage({
      ...base,
      marketplace: null,
      taskType: null,
      assignee: null,
      dueDate: null,
      fields: ["marketplace", "taskType", "assignee", "dueDate"],
    });
    expect(message).toBe(
      "Update on task: Fix listing price for SKU123.\nMarketplace is not set, type is not set, assigned to no one yet and due by Not set."
    );
  });
});
