import { describe, it, expect, beforeAll } from "vitest";
import { authService } from "./authService";

beforeAll(() => {
  process.env.JWT_SECRET = "test-secret";
});

describe("authService", () => {
  it("hashes a password and can verify it back", async () => {
    const hash = await authService.hashPassword("correct horse battery staple");
    expect(await authService.verifyPassword("correct horse battery staple", hash)).toBe(true);
  });

  it("rejects the wrong password against a hash", async () => {
    const hash = await authService.hashPassword("correct horse battery staple");
    expect(await authService.verifyPassword("wrong password", hash)).toBe(false);
  });

  it("signs a session and verifies it back to the same payload", () => {
    const token = authService.signSession({ employeeId: "emp-1" });
    expect(authService.verifySession(token)).toMatchObject({ employeeId: "emp-1" });
  });

  it("rejects a tampered/invalid token", () => {
    expect(authService.verifySession("not-a-real-token")).toBeNull();
  });

  it("throws clearly if JWT_SECRET is missing when signing", () => {
    const original = process.env.JWT_SECRET;
    delete process.env.JWT_SECRET;
    expect(() => authService.signSession({ employeeId: "emp-1" })).toThrow(/JWT_SECRET/);
    process.env.JWT_SECRET = original;
  });
});
