import { describe, it, expect } from "vitest";
import { isValidEmail, passwordProblem, MIN_PASSWORD_LENGTH } from "./credentialRules";
import { normalizeEmail } from "../repositories/employeeRepository";

describe("isValidEmail", () => {
  it("accepts an ordinary work address", () => {
    expect(isValidEmail("shivani@ecom4all.in")).toBe(true);
  });

  it("accepts one with a dot and a plus in it", () => {
    expect(isValidEmail("shivani.patel+tasks@ecom4all.co.in")).toBe(true);
  });

  it("ignores spaces someone left on the ends", () => {
    expect(isValidEmail("  shivani@ecom4all.in  ")).toBe(true);
  });

  // The typos worth catching: they'd lock somebody out of an account with no
  // reset email to fall back on.
  it("rejects a name typed into the email box", () => {
    expect(isValidEmail("Shivani")).toBe(false);
  });

  it("rejects an address with no @", () => {
    expect(isValidEmail("shivani.ecom4all.in")).toBe(false);
  });

  it("rejects an address with no dot after the @", () => {
    expect(isValidEmail("shivani@ecom4all")).toBe(false);
  });

  it("rejects an address with a space in the middle", () => {
    expect(isValidEmail("shivani patel@ecom4all.in")).toBe(false);
  });
});

describe("passwordProblem", () => {
  it("is happy with a long enough password", () => {
    expect(passwordProblem("wintersun24")).toBeNull();
  });

  it("says so when it's too short, in words", () => {
    const problem = passwordProblem("short");
    expect(problem).toContain(String(MIN_PASSWORD_LENGTH));
  });

  it("accepts exactly the minimum length", () => {
    expect(passwordProblem("a".repeat(MIN_PASSWORD_LENGTH))).toBeNull();
  });

  // A password that ends in a space is one nobody can retype reliably.
  it("rejects a password padded with spaces", () => {
    expect(passwordProblem(" wintersun24 ")).toContain("space");
  });

  it("rejects a missing password rather than crashing", () => {
    expect(passwordProblem(undefined as any)).not.toBeNull();
    expect(passwordProblem(null as any)).not.toBeNull();
  });
});

describe("normalizeEmail", () => {
  // Two accounts that differ only in capitals would be two logins for one
  // person, and only one of them would ever be found at login.
  it("lower-cases and trims, so capitals can't make a second account", () => {
    expect(normalizeEmail("  Shivani@Ecom4All.in ")).toBe("shivani@ecom4all.in");
  });
});
