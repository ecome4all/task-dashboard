import { describe, expect, it } from "vitest";
import { sendFailure, sendProblemOf } from "./sendFailure";

// The strings here are real: they are what the adapters throw, with the
// provider's own body pasted in.
const periskope = (status: number, body: string) =>
  new Error(`Periskope send failed (${status}): ${body}`);

describe("sendProblemOf", () => {
  it("reads a switched-off phone as disconnected, not as a bad key", () => {
    // Periskope answers 401 for this as well as for a key it won't accept,
    // and the two need opposite things done about them. This is the case
    // that took an afternoon to find on 17 Aug.
    const err = periskope(
      401,
      '{"code":"UNAUTHORIZED_ERROR","message":"Your phone server instance is switched off. Please call the /phone/restart endpoint to restart the phone","status":401}'
    );
    expect(sendProblemOf(err)).toBe("disconnected");
  });

  it("reads a rejected key as credentials", () => {
    expect(sendProblemOf(periskope(401, '{"message":"Invalid API key"}'))).toBe("credentials");
  });

  it("reads the other statuses", () => {
    expect(sendProblemOf(periskope(429, "rate limited"))).toBe("too_many");
    expect(sendProblemOf(periskope(404, "chat not found"))).toBe("bad_chat");
    expect(sendProblemOf(periskope(503, "upstream"))).toBe("provider_down");
  });

  it("falls back to unknown when there is no status to read", () => {
    expect(sendProblemOf(new Error("socket hang up"))).toBe("unknown");
    expect(sendProblemOf("not an Error at all")).toBe("unknown");
  });

  it("works for the other two providers' wording", () => {
    expect(sendProblemOf(new Error("whapi.cloud send failed (429): slow down"))).toBe("too_many");
    expect(
      sendProblemOf(new Error("WhatsApp Cloud API send failed (401): {}"))
    ).toBe("credentials");
  });
});

describe("sendFailure", () => {
  it("says it is everyone, not this one client, when the phone is off", () => {
    const failure = sendFailure(
      periskope(401, '{"message":"Your phone server instance is switched off."}')
    );
    expect(failure.status).toBe(503);
    expect(failure.error).toContain("not connected");
    expect(failure.error).toContain("anyone");
    // Retrying cannot work until someone relinks, so it must not say Retry.
    expect(failure.error).not.toContain("Retry");
  });

  it("does say Retry when retrying could actually work", () => {
    expect(sendFailure(periskope(429, "")).error).toContain("Retry");
    expect(sendFailure(periskope(502, "")).error).toContain("Retry");
  });

  it("carries what the provider said as detail", () => {
    const failure = sendFailure(periskope(404, "no such chat"));
    expect(failure.detail).toContain("no such chat");
  });
});
