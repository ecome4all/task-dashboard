import { describe, it, expect } from "vitest";
import { isAuthorizedBackupRequest, modelKeys } from "./backup";

const TOKEN = "b".repeat(48);

describe("isAuthorizedBackupRequest", () => {
  it("accepts the right bearer token", () => {
    expect(isAuthorizedBackupRequest(`Bearer ${TOKEN}`, TOKEN)).toBe(true);
  });

  it("rejects a wrong token", () => {
    expect(isAuthorizedBackupRequest(`Bearer ${"c".repeat(48)}`, TOKEN)).toBe(false);
  });

  it("rejects the token without the Bearer prefix", () => {
    expect(isAuthorizedBackupRequest(TOKEN, TOKEN)).toBe(false);
  });

  it("rejects a missing header", () => {
    expect(isAuthorizedBackupRequest(undefined, TOKEN)).toBe(false);
  });

  // Fails closed: an unset or weak token must never let anyone in, including
  // a caller who sends the same empty or short value.
  it("rejects everything when no token is configured", () => {
    expect(isAuthorizedBackupRequest("Bearer ", undefined)).toBe(false);
    expect(isAuthorizedBackupRequest("Bearer ", "")).toBe(false);
  });

  it("rejects everything when the configured token is too short", () => {
    expect(isAuthorizedBackupRequest("Bearer short", "short")).toBe(false);
  });

  it("does not throw on a header of a different length", () => {
    expect(() => isAuthorizedBackupRequest("Bearer x", TOKEN)).not.toThrow();
  });
});

describe("modelKeys", () => {
  it("covers every table, including the ones people touch every day", () => {
    const keys = modelKeys();
    for (const k of ["task", "taskNote", "recurringTask", "employee", "client", "configOption"]) {
      expect(keys).toContain(k);
    }
  });
});
