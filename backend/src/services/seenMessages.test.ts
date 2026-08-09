import { describe, it, expect, beforeEach } from "vitest";
import { markMessageSeen, messageKey, resetSeenMessages } from "./seenMessages";

beforeEach(() => resetSeenMessages());

describe("markMessageSeen", () => {
  it("lets a message through once and never again", () => {
    expect(markMessageSeen("id:abc")).toBe(true);
    expect(markMessageSeen("id:abc")).toBe(false);
    expect(markMessageSeen("id:abc")).toBe(false);
  });

  it("keeps different messages apart", () => {
    expect(markMessageSeen("id:abc")).toBe(true);
    expect(markMessageSeen("id:def")).toBe(true);
  });

  // The real redelivery arrived five seconds later, so the window only has to
  // be comfortably longer than that.
  it("still blocks a redelivery a few seconds later", () => {
    const t0 = 1_000_000;
    expect(markMessageSeen("id:abc", t0)).toBe(true);
    expect(markMessageSeen("id:abc", t0 + 5_000)).toBe(false);
    expect(markMessageSeen("id:abc", t0 + 60_000)).toBe(false);
  });

  // Long after, the same id is almost certainly a different conversation, and
  // holding every id ever seen is a leak in a process that runs for weeks.
  it("forgets a message once it's long past", () => {
    const t0 = 1_000_000;
    expect(markMessageSeen("id:abc", t0)).toBe(true);
    expect(markMessageSeen("id:abc", t0 + 11 * 60 * 1000)).toBe(true);
  });

  it("doesn't grow without limit", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 1500; i++) markMessageSeen(`id:${i}`, t0);
    // The oldest were dropped, so the very first is allowed through again...
    expect(markMessageSeen("id:0", t0)).toBe(true);
    // ...while a recent one is still remembered.
    expect(markMessageSeen("id:1499", t0)).toBe(false);
  });
});

describe("messageKey", () => {
  it("uses the provider's message id when there is one", () => {
    expect(messageKey({ data: { message_id: "wamid.XYZ" } }, "g@g.us", "task: hi")).toBe("id:wamid.XYZ");
  });

  it("falls back to the event id", () => {
    expect(messageKey({ id: "evt_1", data: {} }, "g@g.us", "task: hi")).toBe("id:evt_1");
  });

  // If Periskope ever renames that field, dedupe must not quietly stop
  // working -- that failure would look exactly like the bug it prevents.
  it("still identifies a message with no id at all", () => {
    const key = messageKey({ data: {} }, "g@g.us", "task: hi", "919876543210");
    expect(key).toBe("msg:g@g.us|919876543210|task: hi");
    expect(messageKey({}, "g@g.us", "task: other")).not.toBe(key);
  });
});
