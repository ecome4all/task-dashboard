import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleIncomingTaskMessage } from "./taskIntake";
import { taskRepository } from "../repositories/taskRepository";
import { clientRepository } from "../repositories/clientRepository";
import { employeeRepository } from "../repositories/employeeRepository";
import { unrecognizedMessageRepository } from "../repositories/unrecognizedMessageRepository";
import { WhatsAppAdapter } from "../whatsapp/whatsappAdapter";
import { WhatsAppChannels } from "../whatsapp/resolveAdapter";

vi.mock("../repositories/taskRepository", () => ({
  taskRepository: { create: vi.fn() },
}));
vi.mock("../repositories/clientRepository", () => ({
  clientRepository: { findByChatId: vi.fn(), ensureGroupLinked: vi.fn() },
}));
vi.mock("../repositories/employeeRepository", () => ({
  employeeRepository: { list: vi.fn(), findByName: vi.fn() },
}));
vi.mock("../repositories/unrecognizedMessageRepository", () => ({
  unrecognizedMessageRepository: { create: vi.fn() },
}));

function fakeAdapter() {
  return { sendMessage: vi.fn().mockResolvedValue(undefined) } satisfies WhatsAppAdapter;
}

// The group channel and the official channel are separate adapters — which
// one a reply goes out on is the thing several of these tests are checking.
function fakeChannels(): WhatsAppChannels & { whapi: ReturnType<typeof fakeAdapter> } {
  return { whapi: fakeAdapter(), official: fakeAdapter() };
}

describe("handleIncomingTaskMessage", () => {
  beforeEach(() => {
    vi.mocked(taskRepository.create).mockReset();
    vi.mocked(clientRepository.findByChatId).mockReset();
    vi.mocked(clientRepository.ensureGroupLinked).mockReset();
    vi.mocked(clientRepository.ensureGroupLinked).mockResolvedValue(null);
    vi.mocked(employeeRepository.list).mockReset();
    vi.mocked(employeeRepository.list).mockResolvedValue([] as any);
    vi.mocked(employeeRepository.findByName).mockReset();
    vi.mocked(employeeRepository.findByName).mockResolvedValue(null as any);
    vi.mocked(unrecognizedMessageRepository.create).mockReset();
  });

  it("creates a task and acknowledges on the same channel for a known client", async () => {
    vi.mocked(clientRepository.findByChatId).mockResolvedValue({ id: "client-1", name: "Forensic Files" } as any);
    vi.mocked(taskRepository.create).mockResolvedValue({ id: "task-1" } as any);
    const channels = fakeChannels();

    const task = await handleIncomingTaskMessage({
      source: "whatsapp_official",
      chatId: "919876543210",
      text: "task: reduce stock to 5",
      channels,
    });

    expect(clientRepository.findByChatId).toHaveBeenCalledWith("919876543210", undefined);
    expect(taskRepository.create).toHaveBeenCalledWith({
      source: "whatsapp_official",
      sourceRef: "919876543210",
      description: "reduce stock to 5",
      clientName: "Forensic Files",
    });
    // On the channel it arrived on, not the other one.
    expect(channels.official.sendMessage).toHaveBeenCalledWith("919876543210", "✅ Got it, logged.");
    expect(channels.whapi.sendMessage).not.toHaveBeenCalled();
    expect(unrecognizedMessageRepository.create).not.toHaveBeenCalled();
    expect(task).toEqual({ id: "task-1" });
  });

  it("does nothing and returns null for a non-task message", async () => {
    const channels = fakeChannels();

    const task = await handleIncomingTaskMessage({
      source: "whatsapp_group",
      chatId: "1234@g.us",
      text: "thanks!",
      channels,
    });

    expect(clientRepository.findByChatId).not.toHaveBeenCalled();
    expect(taskRepository.create).not.toHaveBeenCalled();
    expect(channels.whapi.sendMessage).not.toHaveBeenCalled();
    expect(task).toBeNull();
  });

  it("logs to UnrecognizedMessage instead of creating a task for an unknown sender", async () => {
    vi.mocked(clientRepository.findByChatId).mockResolvedValue(null);
    const channels = fakeChannels();

    const task = await handleIncomingTaskMessage({
      source: "whatsapp_group",
      chatId: "919999999999-123@g.us",
      chatName: "Unknown Group",
      text: "task: please help",
      channels,
    });

    expect(unrecognizedMessageRepository.create).toHaveBeenCalledWith({
      source: "whatsapp_group",
      sourceRef: "919999999999-123@g.us",
      text: "please help",
      chatName: "Unknown Group",
    });
    expect(taskRepository.create).not.toHaveBeenCalled();
    expect(channels.whapi.sendMessage).not.toHaveBeenCalled();
    expect(task).toBeNull();
  });

  it("passes the individual sender's phone through to the client lookup, for group messages", async () => {
    vi.mocked(clientRepository.findByChatId).mockResolvedValue({ id: "client-1", name: "Sh" } as any);
    vi.mocked(taskRepository.create).mockResolvedValue({ id: "task-1" } as any);

    await handleIncomingTaskMessage({
      source: "whatsapp_group",
      chatId: "917417017570-1424446551@g.us",
      senderPhone: "919997905444@c.us",
      text: "task: hello",
      channels: fakeChannels(),
    });

    expect(clientRepository.findByChatId).toHaveBeenCalledWith(
      "917417017570-1424446551@g.us",
      "919997905444@c.us"
    );
  });

  it("links the group to the client it recognized, so the rest of the group works next time", async () => {
    vi.mocked(clientRepository.findByChatId).mockResolvedValue({ id: "client-1", name: "Shivani" } as any);
    vi.mocked(taskRepository.create).mockResolvedValue({ id: "task-1" } as any);

    await handleIncomingTaskMessage({
      source: "whatsapp_group",
      chatId: "120363409833141766@g.us",
      chatName: "Test 3",
      senderPhone: "919574726156@c.us",
      text: "task: hello",
      channels: fakeChannels(),
    });

    expect(clientRepository.ensureGroupLinked).toHaveBeenCalledWith(
      "client-1",
      "120363409833141766@g.us",
      "Test 3"
    );
  });

  it("passes a null group name through when the name lookup came back empty", async () => {
    vi.mocked(clientRepository.findByChatId).mockResolvedValue({ id: "client-1", name: "Shivani" } as any);
    vi.mocked(taskRepository.create).mockResolvedValue({ id: "task-1" } as any);

    await handleIncomingTaskMessage({
      source: "whatsapp_group",
      chatId: "120363409833141766@g.us",
      senderPhone: "919574726156@c.us",
      text: "task: hello",
      channels: fakeChannels(),
    });

    expect(clientRepository.ensureGroupLinked).toHaveBeenCalledWith(
      "client-1",
      "120363409833141766@g.us",
      null
    );
  });

  it("doesn't try to link anything for a 1:1 chat, which has no group", async () => {
    vi.mocked(clientRepository.findByChatId).mockResolvedValue({ id: "client-1", name: "Shivani" } as any);
    vi.mocked(taskRepository.create).mockResolvedValue({ id: "task-1" } as any);

    await handleIncomingTaskMessage({
      source: "whatsapp_official",
      chatId: "919876543210",
      text: "task: hello",
      channels: fakeChannels(),
    });

    expect(clientRepository.ensureGroupLinked).not.toHaveBeenCalled();
  });

  it("doesn't link anything for an unrecognized sender — there's no client to link to", async () => {
    vi.mocked(clientRepository.findByChatId).mockResolvedValue(null);

    await handleIncomingTaskMessage({
      source: "whatsapp_group",
      chatId: "120363409833141766@g.us",
      senderPhone: "910000000000@c.us",
      text: "task: hello",
      channels: fakeChannels(),
    });

    expect(clientRepository.ensureGroupLinked).not.toHaveBeenCalled();
  });

  // The task is the thing that matters — a link is a convenience for next
  // time, so losing it must never cost the client their actual task.
  it("still creates the task if the auto-link fails", async () => {
    vi.mocked(clientRepository.findByChatId).mockResolvedValue({ id: "client-1", name: "Shivani" } as any);
    vi.mocked(clientRepository.ensureGroupLinked).mockRejectedValue(new Error("db down"));
    vi.mocked(taskRepository.create).mockResolvedValue({ id: "task-1" } as any);

    const task = await handleIncomingTaskMessage({
      source: "whatsapp_group",
      chatId: "120363409833141766@g.us",
      senderPhone: "919574726156@c.us",
      text: "task: hello",
      channels: fakeChannels(),
    });

    expect(taskRepository.create).toHaveBeenCalled();
    expect(task).toEqual({ id: "task-1" });
  });
});

// Tagging someone's number in the WhatsApp message puts the task on them
// straight away, and tells them about it.
describe("handleIncomingTaskMessage — assigning from a tagged number", () => {
  const SHIVANI = { name: "Shivani", phone: "919876543210" };

  beforeEach(() => {
    vi.mocked(taskRepository.create).mockReset();
    vi.mocked(clientRepository.findByChatId).mockReset();
    vi.mocked(clientRepository.findByChatId).mockResolvedValue({ id: "client-1", name: "BagsGuru" } as any);
    vi.mocked(clientRepository.ensureGroupLinked).mockReset();
    vi.mocked(clientRepository.ensureGroupLinked).mockResolvedValue(null);
    vi.mocked(employeeRepository.list).mockReset();
    vi.mocked(employeeRepository.list).mockResolvedValue([SHIVANI] as any);
    vi.mocked(employeeRepository.findByName).mockReset();
    vi.mocked(employeeRepository.findByName).mockResolvedValue({ ...SHIVANI, active: true } as any);
    vi.mocked(unrecognizedMessageRepository.create).mockReset();
  });

  it("assigns the task to the tagged employee and drops the number from the text", async () => {
    vi.mocked(taskRepository.create).mockResolvedValue({
      id: "task-1",
      description: "fix the listing",
      clientName: "BagsGuru",
      dueDate: null,
    } as any);

    await handleIncomingTaskMessage({
      source: "whatsapp_group",
      chatId: "120363409833141766@g.us",
      text: "task: fix the listing @919876543210",
      channels: fakeChannels(),
    });

    expect(taskRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ description: "fix the listing", assignee: "Shivani" })
    );
  });

  it("messages the tagged employee on their own number", async () => {
    vi.mocked(taskRepository.create).mockResolvedValue({
      id: "task-1",
      description: "fix the listing",
      clientName: "BagsGuru",
      dueDate: null,
    } as any);
    const channels = fakeChannels();

    await handleIncomingTaskMessage({
      source: "whatsapp_group",
      chatId: "120363409833141766@g.us",
      text: "task: fix the listing @919876543210",
      channels,
    });

    const sends = channels.whapi.sendMessage.mock.calls;
    const toEmployee = sends.find((call) => call[0] === "919876543210");
    expect(toEmployee).toBeDefined();
    expect(toEmployee![1]).toContain("Shivani");
    expect(toEmployee![1]).toContain("fix the listing");
  });

  // A task raised on the official channel still has to reach the employee,
  // and the official Cloud API can't start a chat with staff — it goes out on
  // the group channel's number instead.
  it("uses the group channel to reach the employee even for an official-channel task", async () => {
    vi.mocked(taskRepository.create).mockResolvedValue({
      id: "task-1",
      description: "fix the listing",
      clientName: "BagsGuru",
      dueDate: null,
    } as any);
    const channels = fakeChannels();

    await handleIncomingTaskMessage({
      source: "whatsapp_official",
      chatId: "919999999999",
      text: "task: fix the listing @919876543210",
      channels,
    });

    expect(channels.whapi.sendMessage).toHaveBeenCalledWith("919876543210", expect.stringContaining("Shivani"));
  });

  it("leaves a number that belongs to nobody alone", async () => {
    vi.mocked(taskRepository.create).mockResolvedValue({ id: "task-1", description: "x" } as any);

    await handleIncomingTaskMessage({
      source: "whatsapp_group",
      chatId: "120363409833141766@g.us",
      text: "task: call the courier on 918888888888",
      channels: fakeChannels(),
    });

    const created = vi.mocked(taskRepository.create).mock.calls[0][0];
    expect(created.description).toBe("call the courier on 918888888888");
    expect(created.assignee).toBeUndefined();
  });

  // Most messages tag nobody — no reason to read the employee table for them.
  it("doesn't query employees for a message with no number in it", async () => {
    vi.mocked(taskRepository.create).mockResolvedValue({ id: "task-1", description: "x" } as any);

    await handleIncomingTaskMessage({
      source: "whatsapp_group",
      chatId: "120363409833141766@g.us",
      text: "task: fix the listing",
      channels: fakeChannels(),
    });

    expect(employeeRepository.list).not.toHaveBeenCalled();
  });

  // The task is what matters. A failed alert is logged, not fatal.
  it("still creates the task when the message to the employee fails", async () => {
    vi.mocked(taskRepository.create).mockResolvedValue({
      id: "task-1",
      description: "fix the listing",
      clientName: "BagsGuru",
      dueDate: null,
    } as any);
    const channels = fakeChannels();
    channels.whapi.sendMessage.mockRejectedValue(new Error("Periskope down"));

    const task = await handleIncomingTaskMessage({
      source: "whatsapp_group",
      chatId: "120363409833141766@g.us",
      text: "task: fix the listing @919876543210",
      channels,
    });

    expect(task).toMatchObject({ id: "task-1" });
  });
});
