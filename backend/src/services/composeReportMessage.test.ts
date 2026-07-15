import { describe, it, expect } from "vitest";
import { composeReportMessage } from "./composeReportMessage";

describe("composeReportMessage", () => {
  it("puts the description above the link", () => {
    expect(composeReportMessage("Weekly summary — 1 to 7 Oct", "https://docs.google.com/spreadsheets/d/abc123")).toBe(
      "📊 Weekly summary — 1 to 7 Oct\nhttps://docs.google.com/spreadsheets/d/abc123"
    );
  });
});
