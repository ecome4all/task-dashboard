import { describe, it, expect } from "vitest";
import { resolveAdapterForSource } from "./resolveAdapter";
import { WhatsAppAdapter } from "./whatsappAdapter";

describe("resolveAdapterForSource", () => {
  const whapi: WhatsAppAdapter = { sendMessage: async () => {} };
  const official: WhatsAppAdapter = { sendMessage: async () => {} };

  it("resolves whatsapp_official to the official adapter", () => {
    expect(resolveAdapterForSource("whatsapp_official", { whapi, official })).toBe(official);
  });

  it("resolves whatsapp_group to the whapi adapter", () => {
    expect(resolveAdapterForSource("whatsapp_group", { whapi, official })).toBe(whapi);
  });

  it("defaults unknown sources to the whapi adapter", () => {
    expect(resolveAdapterForSource("something_else", { whapi, official })).toBe(whapi);
  });
});
