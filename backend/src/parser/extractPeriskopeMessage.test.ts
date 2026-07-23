import { describe, it, expect } from "vitest";
import { extractPeriskopeMessage } from "./extractPeriskopeMessage";

function messageCreated(data: unknown) {
  return { event_type: "message.created", data, id: "delivery-1", org_id: "org-1", previous_attributes: {} };
}

describe("extractPeriskopeMessage", () => {
  it("reads a group text message", () => {
    const payload = messageCreated({
      message_id: "msg-1",
      chat_id: "120363123456789-1234567890@g.us",
      chat_name: "Forensic Files Team",
      from: "919876543210@c.us",
      body: "task: update price for SKU123",
      message_type: "chat",
      from_me: false,
    });

    expect(extractPeriskopeMessage(payload)).toEqual({
      chatId: "120363123456789-1234567890@g.us",
      text: "task: update price for SKU123",
      chatName: "Forensic Files Team",
    });
  });

  it("reads a 1:1 text message with no chat_name", () => {
    const payload = messageCreated({
      chat_id: "919876543210@c.us",
      body: "task: reduce stock to 5",
      message_type: "chat",
      from_me: false,
    });

    expect(extractPeriskopeMessage(payload)).toEqual({
      chatId: "919876543210@c.us",
      text: "task: reduce stock to 5",
    });
  });

  it("ignores our own outgoing messages (from_me: true)", () => {
    const payload = messageCreated({
      chat_id: "919876543210@c.us",
      body: "✅ Got it, logged.",
      message_type: "chat",
      from_me: true,
    });

    expect(extractPeriskopeMessage(payload)).toBeNull();
  });

  it("ignores non-text messages (e.g. voice notes)", () => {
    const payload = messageCreated({
      chat_id: "919876543210@c.us",
      message_type: "ptt",
      from_me: false,
    });

    expect(extractPeriskopeMessage(payload)).toBeNull();
  });

  it("ignores other event types (e.g. delivery/read receipts)", () => {
    const payload = {
      event_type: "message.ack.updated",
      data: { chat_id: "919876543210@c.us", body: "task: x", from_me: false },
      id: "delivery-1",
      org_id: "org-1",
      previous_attributes: {},
    };

    expect(extractPeriskopeMessage(payload)).toBeNull();
  });

  it("returns null when there's no text body", () => {
    const payload = messageCreated({ chat_id: "919876543210@c.us", from_me: false });
    expect(extractPeriskopeMessage(payload)).toBeNull();
  });

  it("returns null for a completely empty payload", () => {
    expect(extractPeriskopeMessage({})).toBeNull();
  });
});
