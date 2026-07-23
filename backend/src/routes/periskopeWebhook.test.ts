import { describe, it, expect } from "vitest";
import crypto from "crypto";
import { isValidSignature } from "./periskopeWebhook";

const SECRET = "peri_test_secret";

function sign(body: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(Buffer.from(body, "utf8")).digest("hex");
}

describe("isValidSignature", () => {
  it("accepts a correctly signed body", () => {
    const body = JSON.stringify({ event: "message.created", data: { chat_id: "1@g.us" } });
    const signature = sign(body, SECRET);
    expect(isValidSignature(Buffer.from(body, "utf8"), signature, SECRET)).toBe(true);
  });

  it("rejects a signature computed with the wrong secret", () => {
    const body = JSON.stringify({ event: "message.created" });
    const signature = sign(body, "wrong_secret");
    expect(isValidSignature(Buffer.from(body, "utf8"), signature, SECRET)).toBe(false);
  });

  it("rejects a body that was tampered with after signing", () => {
    const original = JSON.stringify({ event: "message.created", data: { chat_id: "1@g.us" } });
    const signature = sign(original, SECRET);
    const tampered = JSON.stringify({ event: "message.created", data: { chat_id: "2@g.us" } });
    expect(isValidSignature(Buffer.from(tampered, "utf8"), signature, SECRET)).toBe(false);
  });

  it("rejects a missing signature", () => {
    const body = Buffer.from(JSON.stringify({ event: "message.created" }), "utf8");
    expect(isValidSignature(body, undefined, SECRET)).toBe(false);
  });

  it("rejects a missing raw body", () => {
    expect(isValidSignature(undefined, "somesignature", SECRET)).toBe(false);
  });

  it("does not throw when the signature has a different length than expected", () => {
    const body = Buffer.from(JSON.stringify({ event: "message.created" }), "utf8");
    expect(() => isValidSignature(body, "short", SECRET)).not.toThrow();
    expect(isValidSignature(body, "short", SECRET)).toBe(false);
  });
});
