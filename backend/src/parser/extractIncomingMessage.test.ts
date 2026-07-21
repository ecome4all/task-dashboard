import { describe, it, expect } from "vitest";
import { extractIncomingMessage } from "./extractIncomingMessage";

describe("extractIncomingMessage", () => {
  it("reads whapi-style nested messages array with chat_id + text.body", () => {
    const payload = {
      messages: [{ chat_id: "1234@g.us", text: { body: "task: reduce stock" } }],
    };
    expect(extractIncomingMessage(payload)).toEqual({
      chatId: "1234@g.us",
      text: "task: reduce stock",
    });
  });

  it("reads a flat payload with phone + text", () => {
    const payload = { phone: "+919876543210", text: "task: update price" };
    expect(extractIncomingMessage(payload)).toEqual({
      chatId: "+919876543210",
      text: "task: update price",
    });
  });

  it("reads a flat payload with group_id + body", () => {
    const payload = { group_id: "grp-1", body: "task: new listing" };
    expect(extractIncomingMessage(payload)).toEqual({
      chatId: "grp-1",
      text: "task: new listing",
    });
  });

  it("prefers messages[0].from when chat_id is absent", () => {
    const payload = { messages: [{ from: "sender-1", body: "task: x" }] };
    expect(extractIncomingMessage(payload)).toEqual({
      chatId: "sender-1",
      text: "task: x",
    });
  });

  it("returns null when there's no identifiable sender/chat", () => {
    expect(extractIncomingMessage({ text: "task: no sender here" })).toBeNull();
  });

  it("returns null when there's no text field", () => {
    expect(extractIncomingMessage({ chat_id: "1234@g.us" })).toBeNull();
  });

  it("returns null for a completely empty payload", () => {
    expect(extractIncomingMessage({})).toBeNull();
  });

  it("captures chat_name when present, for linking a group to a client later", () => {
    const payload = {
      messages: [{ chat_id: "1234@g.us", chat_name: "Forensic Files Team", text: { body: "task: x" } }],
    };
    expect(extractIncomingMessage(payload)).toEqual({
      chatId: "1234@g.us",
      text: "task: x",
      chatName: "Forensic Files Team",
    });
  });
});
