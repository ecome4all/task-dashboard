import { describe, it, expect, vi, beforeEach } from "vitest";
import { composeAssignmentMessage, notifyAssignee } from "./assignmentNotice";
import { parseTaskMessage } from "../parser/taskParser";
import { employeeRepository } from "../repositories/employeeRepository";
import { WhatsAppChannels } from "../whatsapp/resolveAdapter";

vi.mock("../repositories/employeeRepository", () => ({
  employeeRepository: { findByName: vi.fn() },
}));

function fakeChannels() {
  return {
    whapi: { sendMessage: vi.fn().mockResolvedValue(undefined) },
    official: { sendMessage: vi.fn().mockResolvedValue(undefined) },
  } as unknown as WhatsAppChannels & { whapi: { sendMessage: ReturnType<typeof vi.fn> } };
}

const TASK = {
  description: "Fix the listing",
  clientName: "BagsGuru",
  dueDate: new Date("2026-08-10T00:00:00"),
};

describe("composeAssignmentMessage", () => {
  it("names the employee, the task, the client and the due date", () => {
    const message = composeAssignmentMessage("Shivani", TASK);
    expect(message).toContain("Shivani");
    expect(message).toContain("Fix the listing");
    expect(message).toContain("BagsGuru");
    expect(message).toContain("10 Aug 2026");
  });

  it("says the due date isn't set rather than leaving it blank", () => {
    expect(composeAssignmentMessage("Shivani", { ...TASK, dueDate: null })).toContain("Not set");
  });

  it("leaves the client line out when the task has no client", () => {
    expect(composeAssignmentMessage("Shivani", { ...TASK, clientName: null })).not.toContain("Client:");
  });

  // Same rule as every other message this app sends: it can come back
  // through the webhook, and must not read as a brand new task.
  it("does not read as a task if it comes back through the webhook", () => {
    expect(parseTaskMessage(composeAssignmentMessage("Shivani", TASK))).toBeNull();
    expect(parseTaskMessage(composeAssignmentMessage("Shivani", { ...TASK, description: "task: sneaky" }))).toBeNull();
  });
});

describe("notifyAssignee", () => {
  beforeEach(() => {
    vi.mocked(employeeRepository.findByName).mockReset();
  });

  it("sends to the employee's saved number", async () => {
    vi.mocked(employeeRepository.findByName).mockResolvedValue({
      name: "Shivani",
      phone: "919876543210",
      active: true,
    } as any);
    const channels = fakeChannels();

    expect(await notifyAssignee("Shivani", TASK, channels)).toBe(true);
    expect(channels.whapi.sendMessage).toHaveBeenCalledWith("919876543210", expect.stringContaining("Shivani"));
  });

  it("sends nothing when the task isn't assigned to anyone", async () => {
    const channels = fakeChannels();
    expect(await notifyAssignee(null, TASK, channels)).toBe(false);
    expect(channels.whapi.sendMessage).not.toHaveBeenCalled();
  });

  it("sends nothing when the employee has no number saved", async () => {
    vi.mocked(employeeRepository.findByName).mockResolvedValue({
      name: "Shivani",
      phone: null,
      active: true,
    } as any);
    const channels = fakeChannels();

    expect(await notifyAssignee("Shivani", TASK, channels)).toBe(false);
    expect(channels.whapi.sendMessage).not.toHaveBeenCalled();
  });

  it("sends nothing when the name doesn't match an employee any more", async () => {
    vi.mocked(employeeRepository.findByName).mockResolvedValue(null as any);
    const channels = fakeChannels();

    expect(await notifyAssignee("Someone Who Left", TASK, channels)).toBe(false);
    expect(channels.whapi.sendMessage).not.toHaveBeenCalled();
  });

  it("sends nothing to a deactivated employee", async () => {
    vi.mocked(employeeRepository.findByName).mockResolvedValue({
      name: "Shivani",
      phone: "919876543210",
      active: false,
    } as any);
    const channels = fakeChannels();

    expect(await notifyAssignee("Shivani", TASK, channels)).toBe(false);
    expect(channels.whapi.sendMessage).not.toHaveBeenCalled();
  });

  // Callers assign first and notify after, so a failure here must never
  // reject — an unhandled rejection would take the whole process down.
  it("swallows a send failure instead of throwing", async () => {
    vi.mocked(employeeRepository.findByName).mockResolvedValue({
      name: "Shivani",
      phone: "919876543210",
      active: true,
    } as any);
    const channels = fakeChannels();
    channels.whapi.sendMessage.mockRejectedValue(new Error("Periskope 401"));

    expect(await notifyAssignee("Shivani", TASK, channels)).toBe(false);
  });

  it("swallows a database failure instead of throwing", async () => {
    vi.mocked(employeeRepository.findByName).mockRejectedValue(new Error("db down"));
    expect(await notifyAssignee("Shivani", TASK, fakeChannels())).toBe(false);
  });
});
