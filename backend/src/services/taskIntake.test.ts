import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleIncomingTaskMessage } from "./taskIntake";
import { taskRepository } from "../repositories/taskRepository";
import { clientRepository } from "../repositories/clientRepository";
import { unrecognizedMessageRepository } from "../repositories/unrecognizedMessageRepository";
import { WhatsAppAdapter } from "../whatsapp/whatsappAdapter";

vi.mock("../repositories/taskRepository", () => ({
  taskRepository: { create: vi.fn() },
}));
vi.mock("../repositories/clientRepository", () => ({
  clientRepository: { findByChatId: vi.fn() },
}));
vi.mock("../repositories/unrecognizedMessageRepository", () => ({
  unrecognizedMessageRepository: { create: vi.fn() },
}));

function fakeAdapter() {
  return { sendMessage: vi.fn().mockResolvedValue(undefined) } satisfies WhatsAppAdapter;
}

describe("handleIncomingTaskMessage", () => {
  beforeEach(() => {
    vi.mocked(taskRepository.create).mockReset();
    vi.mocked(clientRepository.findByChatId).mockReset();
    vi.mocked(unrecognizedMessageRepository.create).mockReset();
  });

  it("creates a task and acknowledges on the same channel for a known client", async () => {
    vi.mocked(clientRepository.findByChatId).mockResolvedValue({ id: "client-1", name: "Forensic Files" } as any);
    vi.mocked(taskRepository.create).mockResolvedValue({ id: "task-1" } as any);
    const whatsapp = fakeAdapter();

    const task = await handleIncomingTaskMessage({
      source: "whatsapp_official",
      chatId: "919876543210",
      text: "task: reduce stock to 5",
      whatsapp,
    });

    expect(clientRepository.findByChatId).toHaveBeenCalledWith("919876543210", undefined);
    expect(taskRepository.create).toHaveBeenCalledWith({
      source: "whatsapp_official",
      sourceRef: "919876543210",
      description: "reduce stock to 5",
      clientName: "Forensic Files",
    });
    expect(whatsapp.sendMessage).toHaveBeenCalledWith("919876543210", "✅ Got it, logged.");
    expect(unrecognizedMessageRepository.create).not.toHaveBeenCalled();
    expect(task).toEqual({ id: "task-1" });
  });

  it("does nothing and returns null for a non-task message", async () => {
    const whatsapp = fakeAdapter();

    const task = await handleIncomingTaskMessage({
      source: "whatsapp_group",
      chatId: "1234@g.us",
      text: "thanks!",
      whatsapp,
    });

    expect(clientRepository.findByChatId).not.toHaveBeenCalled();
    expect(taskRepository.create).not.toHaveBeenCalled();
    expect(whatsapp.sendMessage).not.toHaveBeenCalled();
    expect(task).toBeNull();
  });

  it("logs to UnrecognizedMessage instead of creating a task for an unknown sender", async () => {
    vi.mocked(clientRepository.findByChatId).mockResolvedValue(null);
    const whatsapp = fakeAdapter();

    const task = await handleIncomingTaskMessage({
      source: "whatsapp_group",
      chatId: "919999999999-123@g.us",
      chatName: "Unknown Group",
      text: "task: please help",
      whatsapp,
    });

    expect(unrecognizedMessageRepository.create).toHaveBeenCalledWith({
      source: "whatsapp_group",
      sourceRef: "919999999999-123@g.us",
      text: "please help",
      chatName: "Unknown Group",
    });
    expect(taskRepository.create).not.toHaveBeenCalled();
    expect(whatsapp.sendMessage).not.toHaveBeenCalled();
    expect(task).toBeNull();
  });

  it("passes the individual sender's phone through to the client lookup, for group messages", async () => {
    vi.mocked(clientRepository.findByChatId).mockResolvedValue({ id: "client-1", name: "Sh" } as any);
    vi.mocked(taskRepository.create).mockResolvedValue({ id: "task-1" } as any);
    const whatsapp = fakeAdapter();

    await handleIncomingTaskMessage({
      source: "whatsapp_group",
      chatId: "917417017570-1424446551@g.us",
      senderPhone: "919997905444@c.us",
      text: "task: hello",
      whatsapp,
    });

    expect(clientRepository.findByChatId).toHaveBeenCalledWith(
      "917417017570-1424446551@g.us",
      "919997905444@c.us"
    );
  });
});
