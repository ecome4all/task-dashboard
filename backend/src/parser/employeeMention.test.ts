import { describe, it, expect } from "vitest";
import { containsPhoneNumber, findEmployeeMention, MentionableEmployee } from "./employeeMention";

const EMPLOYEES: MentionableEmployee[] = [
  { name: "Shivani", phone: "919876543210" },
  { name: "Kinjal Patel", phone: "919574726156" },
  { name: "No Number", phone: null },
];

describe("findEmployeeMention", () => {
  // How a WhatsApp tag actually reaches us: the app writes the tagged
  // person's number into the message body.
  it("matches a tagged number and takes it out of the description", () => {
    const found = findEmployeeMention("fix the listing @919876543210", EMPLOYEES);
    expect(found?.employee.name).toBe("Shivani");
    expect(found?.description).toBe("fix the listing");
  });

  it("matches a number typed without the country code", () => {
    expect(findEmployeeMention("fix the listing @9876543210", EMPLOYEES)?.employee.name).toBe("Shivani");
  });

  it("matches a number typed with spaces and a plus", () => {
    expect(findEmployeeMention("fix the listing +91 98765 43210", EMPLOYEES)?.employee.name).toBe("Shivani");
  });

  it("takes the number out from the middle of the text too", () => {
    const found = findEmployeeMention("@919876543210 please check the pricing", EMPLOYEES);
    expect(found?.description).toBe("please check the pricing");
  });

  it("finds nobody when the number belongs to no employee", () => {
    expect(findEmployeeMention("call the courier on 918888888888", EMPLOYEES)).toBeNull();
  });

  it("finds nobody when there's no number at all", () => {
    expect(findEmployeeMention("fix the listing", EMPLOYEES)).toBeNull();
  });

  // A date, an order id, a quantity — none of these are 10-digit numbers, so
  // none of them can silently assign a task to somebody.
  it("ignores numbers that are too short to be a phone number", () => {
    expect(findEmployeeMention("reduce stock to 5 by 12-08-2026", EMPLOYEES)).toBeNull();
  });

  it("skips an employee with no number saved rather than matching them", () => {
    expect(findEmployeeMention("something @0000000000", EMPLOYEES)).toBeNull();
  });

  // A task has one assignee, so the first number that belongs to somebody
  // wins rather than the message being rejected as ambiguous.
  it("takes the first tagged employee when two are tagged", () => {
    const found = findEmployeeMention("@919876543210 @919574726156 check this", EMPLOYEES);
    expect(found?.employee.name).toBe("Shivani");
  });

  // Better a task with an odd-looking description than a blank row nobody
  // can identify on the board.
  it("keeps the original text when the tag was the whole message", () => {
    const found = findEmployeeMention("@919876543210", EMPLOYEES);
    expect(found?.employee.name).toBe("Shivani");
    expect(found?.description).toBe("@919876543210");
  });
});

describe("containsPhoneNumber", () => {
  it("is true for a message with a number in it", () => {
    expect(containsPhoneNumber("fix the listing @919876543210")).toBe(true);
  });

  it("is false for a message with no number in it", () => {
    expect(containsPhoneNumber("fix the listing")).toBe(false);
  });

  // A global regex keeps its own position between calls — asking twice must
  // give the same answer both times.
  it("gives the same answer when asked twice", () => {
    expect(containsPhoneNumber("@919876543210")).toBe(true);
    expect(containsPhoneNumber("@919876543210")).toBe(true);
  });
});
