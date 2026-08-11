import { describe, it, expect } from "vitest";
import { extractTaskDetails, findDueDate, findMarketplace } from "./taskDetails";

// The live seeded list, so these tests break if the real options stop
// matching what the parser can read.
const MARKETPLACES = [
  { value: "amazon", label: "Amazon" },
  { value: "flipkart", label: "Flipkart" },
  { value: "meesho", label: "Meesho" },
  { value: "other", label: "Other" },
];

// A fixed "now" — 11 August 2026, mid-morning India time. Every relative and
// year-less date below is read against this.
const NOW = new Date("2026-08-11T05:00:00.000Z");

// Due dates are whole days at midnight UTC, the same value the board's date
// box writes — comparing the ISO string is comparing exactly what's stored.
function due(text: string): string | null {
  return findDueDate(text, NOW)?.dueDate.toISOString() ?? null;
}

describe("findDueDate", () => {
  it("reads a date written day-first, as it is in India", () => {
    expect(due("fix the listing due 20/8")).toBe("2026-08-20T00:00:00.000Z");
    expect(due("fix the listing due 8/9")).toBe("2026-09-08T00:00:00.000Z");
  });

  it("takes any of the separators people actually type", () => {
    expect(due("due 20-08-2026")).toBe("2026-08-20T00:00:00.000Z");
    expect(due("due 20.8.26")).toBe("2026-08-20T00:00:00.000Z");
    expect(due("due 20 / 8")).toBe("2026-08-20T00:00:00.000Z");
  });

  it("reads a written month, in either order", () => {
    expect(due("due 20 Aug")).toBe("2026-08-20T00:00:00.000Z");
    expect(due("due 20th August 2026")).toBe("2026-08-20T00:00:00.000Z");
    expect(due("due Aug 20")).toBe("2026-08-20T00:00:00.000Z");
    expect(due("due 20 of September")).toBe("2026-09-20T00:00:00.000Z");
  });

  it("takes the other words people introduce a deadline with", () => {
    expect(due("fix this by 20/8")).toBe("2026-08-20T00:00:00.000Z");
    expect(due("deadline 20/8")).toBe("2026-08-20T00:00:00.000Z");
    expect(due("due date: 20/8")).toBe("2026-08-20T00:00:00.000Z");
    expect(due("due - 20/8")).toBe("2026-08-20T00:00:00.000Z");
  });

  it("reads today and tomorrow against the day it is in India", () => {
    expect(due("due today")).toBe("2026-08-11T00:00:00.000Z");
    expect(due("due tomorrow")).toBe("2026-08-12T00:00:00.000Z");
  });

  // The window this is here for: 2am in India is still the previous day in
  // UTC, where the server runs. "Due today" must not arrive already overdue.
  it("uses India's day, not the server's, just after midnight", () => {
    const lateNight = new Date("2026-08-11T20:30:00.000Z"); // 2:00am, 12 Aug IST
    expect(findDueDate("due today", lateNight)?.dueDate.toISOString()).toBe("2026-08-12T00:00:00.000Z");
  });

  it("reads a two-digit year as this century", () => {
    expect(due("due 20/8/26")).toBe("2026-08-20T00:00:00.000Z");
  });

  // "due 5/1" written in December means next January, not eleven months ago.
  it("rolls a year-less date forward when this year's has long gone", () => {
    const december = new Date("2026-12-20T05:00:00.000Z");
    expect(findDueDate("due 5/1", december)?.dueDate.toISOString()).toBe("2027-01-05T00:00:00.000Z");
  });

  // A date a few days back is someone logging work that's already late —
  // honest, and not to be quietly pushed a year out.
  it("leaves a date that has only just passed where it is", () => {
    expect(due("due 5/8")).toBe("2026-08-05T00:00:00.000Z");
  });

  it("ignores a date that doesn't exist", () => {
    expect(due("due 31/2")).toBeNull();
    expect(due("due 45/8")).toBeNull();
    expect(due("due 20/13")).toBeNull();
  });

  it("reads nothing out of a message with no date in it", () => {
    expect(due("fix the listing images")).toBeNull();
    expect(due("due diligence on the account")).toBeNull();
  });

  // "by" only counts when a date follows it — otherwise every "rejected by
  // amazon" would be a deadline.
  it("does not treat a word after 'by' as a date", () => {
    expect(due("listing rejected by amazon")).toBeNull();
    expect(due("stock sent by the client")).toBeNull();
  });

  // A tagged employee number is digits with dashes too — it must not be
  // eaten as a date, and the number-matching that follows must still see it.
  it("leaves a tagged phone number alone", () => {
    expect(due("fix the listing @919876543210")).toBeNull();
    expect(due("assigned by 919876543210")).toBeNull();
  });
});

describe("findMarketplace", () => {
  it("finds a marketplace named anywhere in the message", () => {
    expect(findMarketplace("listing not live on flipkart", MARKETPLACES)).toBe("flipkart");
    expect(findMarketplace("Amazon claim pending", MARKETPLACES)).toBe("amazon");
  });

  it("takes the first one mentioned when there are two", () => {
    expect(findMarketplace("flipkart order rejected, not amazon", MARKETPLACES)).toBe("flipkart");
  });

  it("matches whole words only", () => {
    expect(findMarketplace("amazonbasics cable listing", MARKETPLACES)).toBeNull();
  });

  // "other" is ordinary English long before it's a marketplace.
  it("never reads the catch-all option out of a sentence", () => {
    expect(findMarketplace("waiting for other details from the client", MARKETPLACES)).toBeNull();
  });

  it("reads an option an admin added, by its own label", () => {
    const withNew = [...MARKETPLACES, { value: "own_website", label: "Own Website" }];
    expect(findMarketplace("orders stuck on own website", withNew)).toBe("own_website");
    expect(findMarketplace("orders stuck on Own Website", withNew)).toBe("own_website");
  });

  it("says nothing when no marketplace is named", () => {
    expect(findMarketplace("fix the listing images", MARKETPLACES)).toBeNull();
  });
});

describe("extractTaskDetails", () => {
  it("reads both out of one message and tidies the text", () => {
    const result = extractTaskDetails("listing not live on flipkart due 20/8", MARKETPLACES, NOW);
    expect(result.marketplace).toBe("flipkart");
    expect(result.dueDate?.toISOString()).toBe("2026-08-20T00:00:00.000Z");
    // The date phrase goes — it's a column now, not part of the work.
    expect(result.description).toBe("listing not live on flipkart");
  });

  it("keeps the marketplace word in the sentence", () => {
    const result = extractTaskDetails("amazon listing rejected", MARKETPLACES, NOW);
    expect(result.marketplace).toBe("amazon");
    expect(result.description).toBe("amazon listing rejected");
  });

  it("takes the punctuation that introduced the date with it", () => {
    const result = extractTaskDetails("fix the listing, due 20 Aug", MARKETPLACES, NOW);
    expect(result.description).toBe("fix the listing");
  });

  it("cuts the date out of the middle without joining the words up", () => {
    const result = extractTaskDetails("fix due 20/8 the listing", MARKETPLACES, NOW);
    expect(result.description).toBe("fix the listing");
  });

  // A blank task row would be worse than a redundant one.
  it("keeps the original text when the date was the whole message", () => {
    const result = extractTaskDetails("due 20/8", MARKETPLACES, NOW);
    expect(result.dueDate?.toISOString()).toBe("2026-08-20T00:00:00.000Z");
    expect(result.description).toBe("due 20/8");
  });

  it("changes nothing about a message that names neither", () => {
    const result = extractTaskDetails("fix the listing images", MARKETPLACES, NOW);
    expect(result).toEqual({
      description: "fix the listing images",
      marketplace: null,
      dueDate: null,
    });
  });
});
