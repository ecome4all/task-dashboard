import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleIncomingTaskMessage } from "./taskIntake";
import { taskRepository } from "../repositories/taskRepository";
import { WhatsAppAdapter } from "../whatsapp/whatsappAdapter";

vi.mock("../repositories/taskRepository", () => ({
  taskRepository: { create: vi.fn() },
}));

function fakeAdapter() {
  return { sendMessage: vi.fn().mockResolvedValue(undefined) } satisfies WhatsAppAdapter;
}

describe("handleIncomingTaskMessage", () => {
  beforeEach(() => {
    vi.mocked(taskRepository.create).mockReset();
  });

  it("creates a task and acknowledges on the same channel for a task: message", async () => {
    vi.mocked(taskRepository.create).mockResolvedValue({ id: "task-1" } as any);
    const whatsapp = fakeAdapter();

    const task = await handleIncomingTaskMessage({
      source: "whatsapp_official",
      chatId: "919876543210",
      text: "task: reduce stock to 5",
      whatsapp,
    });

    expect(taskRepository.create).toHaveBeenCalledWith({
      source: "whatsapp_official",
      sourceRef: "919876543210",
      description: "reduce stock to 5",
    });
    expect(whatsapp.sendMessage).toHaveBeenCalledWith("919876543210", "✅ Got it, logged.");
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

    expect(taskRepository.create).not.toHaveBeenCalled();
    expect(whatsapp.sendMessage).not.toHaveBeenCalled();
    expect(task).toBeNull();
  });
});
