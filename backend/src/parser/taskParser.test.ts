import { describe, it, expect } from "vitest";
import { parseTaskMessage } from "./taskParser";

describe("parseTaskMessage", () => {
  it("extracts the description after a task: prefix", () => {
    expect(parseTaskMessage("task: fix listing price for SKU123")).toEqual({
      description: "fix listing price for SKU123",
    });
  });

  it("is case-insensitive on the prefix", () => {
    expect(parseTaskMessage("TASK: reduce stock to 5")).toEqual({
      description: "reduce stock to 5",
    });
  });

  it("tolerates missing space after the colon", () => {
    expect(parseTaskMessage("task:no space here")).toEqual({
      description: "no space here",
    });
  });

  it("tolerates extra whitespace around the description", () => {
    expect(parseTaskMessage("task:   padded description   ")).toEqual({
      description: "padded description",
    });
  });

  it("returns null when there's no task: prefix", () => {
    expect(parseTaskMessage("thanks!")).toBeNull();
    expect(parseTaskMessage("ok")).toBeNull();
  });

  it("returns null when the prefix has no content after it", () => {
    expect(parseTaskMessage("task:")).toBeNull();
    expect(parseTaskMessage("task:   ")).toBeNull();
  });

  it("does not match task: appearing mid-message, only at the start", () => {
    expect(parseTaskMessage("please see task: below")).toBeNull();
  });

  it("accepts - and = as the separator, not just :", () => {
    expect(parseTaskMessage("task- fix listing price")).toEqual({ description: "fix listing price" });
    expect(parseTaskMessage("task=fix listing price")).toEqual({ description: "fix listing price" });
  });

  it("accepts a space before the separator", () => {
    expect(parseTaskMessage("task : fix listing price")).toEqual({ description: "fix listing price" });
    expect(parseTaskMessage("task - fix listing price")).toEqual({ description: "fix listing price" });
    expect(parseTaskMessage("task = fix listing price")).toEqual({ description: "fix listing price" });
  });
});
