import { describe, it, expect } from "vitest";
import { extractOfficialMessage } from "./extractOfficialMessage";

function wrapMessage(message: unknown) {
  return {
    object: "whatsapp_business_account",
    entry: [{ id: "acct-1", changes: [{ value: { messages: [message] }, field: "messages" }] }],
  };
}

describe("extractOfficialMessage", () => {
  it("reads a standard text message payload", () => {
    const payload = wrapMessage({
      from: "919876543210",
      id: "wamid.abc",
      timestamp: "1720000000",
      type: "text",
      text: { body: "task: update price for SKU123" },
    });

    expect(extractOfficialMessage(payload)).toEqual({
      chatId: "919876543210",
      text: "task: update price for SKU123",
    });
  });

  it("returns null for a status-update webhook (no messages array)", () => {
    const payload = {
      object: "whatsapp_business_account",
      entry: [{ id: "acct-1", changes: [{ value: { statuses: [{ status: "delivered" }] }, field: "messages" }] }],
    };
    expect(extractOfficialMessage(payload)).toBeNull();
  });

  it("returns null when the message has no text body (e.g. an image)", () => {
    const payload = wrapMessage({ from: "919876543210", type: "image", image: { id: "media-1" } });
    expect(extractOfficialMessage(payload)).toBeNull();
  });

  it("returns null for a completely empty payload", () => {
    expect(extractOfficialMessage({})).toBeNull();
  });
});
