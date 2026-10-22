import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleIncomingTaskMessage } from "./taskIntake";
import { taskRepository } from "../repositories/taskRepository";
import { clientRepository } from "../repositories/clientRepository";
import { employeeRepository } from "../repositories/employeeRepository";
import { unrecognizedMessageRepository } from "../repositories/unrecognizedMessageRepository";
import { taskNoteRepository } from "../repositories/taskNoteRepository";
import { configOptionRepository } from "../repositories/configOptionRepository";
import { WhatsAppAdapter } from "../whatsapp/whatsappAdapter";
import { WhatsAppChannels } from "../whatsapp/resolveAdapter";

vi.mock("../repositories/taskRepository", () => ({
  taskRepository: { create: vi.fn(), findDuplicateOf: vi.fn() },
}));
vi.mock("../repositories/clientRepository", () => ({
  clientRepository: { findByChatId: vi.fn(), ensureGroupLinked: vi.fn() },
}));
vi.mock("../repositories/employeeRepository", () => ({
  employeeRepository: { list: vi.fn(), findByName: vi.fn() },
}));
vi.mock("../repositories/taskNoteRepository", () => ({
  taskNoteRepository: { create: vi.fn() },
}));
vi.mock("../repositories/unrecognizedMessageRepository", () => ({
  unrecognizedMessageRepository: { create: vi.fn() },
}));
// Read on every task message, to match a marketplace named in it against the
// live list — see parser/taskDetails.ts.
vi.mock("../repositories/configOptionRepository", () => ({
  configOptionRepository: { list: vi.fn() },
}));

const MARKETPLACE_OPTIONS = [
  { value: "amazon", label: "Amazon" },
  { value: "flipkart", label: "Flipkart" },
  { value: "other", label: "Other" },
];

function fakeAdapter() {
  return { sendMessage: vi.fn().mockResolvedValue(undefined) } satisfies WhatsAppAdapter;
}

function fakeChannels(): WhatsAppChannels & { periskope: ReturnType<typeof fakeAdapter> } {
  return { periskope: fakeAdapter() };
}

describe("handleIncomingTaskMessage", () => {
  beforeEach(() => {
    vi.mocked(taskRepository.create).mockReset();
    // Nothing logged a moment ago, unless a test says otherwise — see the
    // redelivery case at the bottom of this file.
    vi.mocked(taskRepository.findDuplicateOf).mockReset();
    vi.mocked(taskRepository.findDuplicateOf).mockResolvedValue(null);
    vi.mocked(clientRepository.findByChatId).mockReset();
    vi.mocked(clientRepository.ensureGroupLinked).mockReset();
    vi.mocked(clientRepository.ensureGroupLinked).mockResolvedValue(null);
    vi.mocked(employeeRepository.list).mockReset();
    vi.mocked(employeeRepository.list).mockResolvedValue([] as any);
    vi.mocked(employeeRepository.findByName).mockReset();
    vi.mocked(employeeRepository.findByName).mockResolvedValue(null as any);
    vi.mocked(unrecognizedMessageRepository.create).mockReset();
    vi.mocked(configOptionRepository.list).mockReset();
    vi.mocked(configOptionRepository.list).mockResolvedValue(MARKETPLACE_OPTIONS as any);
  });

  it("creates a task and acknowledges in the same chat for a known client", async () => {
    vi.mocked(clientRepository.findByChatId).mockResolvedValue({ id: "client-1", name: "Forensic Files" } as any);
    vi.mocked(taskRepository.create).mockResolvedValue({ id: "task-1" } as any);
    const channels = fakeChannels();

    const task = await handleIncomingTaskMessage({
      source: "whatsapp_group",
      chatId: "919876543210",
      text: "task: reduce stock to 5",
      channels,
    });

    expect(clientRepository.findByChatId).toHaveBeenCalledWith("919876543210", undefined);
    expect(taskRepository.create).toHaveBeenCalledWith({
      source: "whatsapp_group",
      sourceRef: "919876543210",
      description: "reduce stock to 5",
      clientName: "Forensic Files",
      // Nobody is on this client, so it lands unassigned — the same board
      // state every task arrived in before clients had an employee at all.
      assignee: null,
    });
    expect(channels.periskope.sendMessage).toHaveBeenCalledWith("919876543210", "✅ Got it, logged.");
    expect(unrecognizedMessageRepository.create).not.toHaveBeenCalled();
    expect(task).toEqual({ id: "task-1" });
  });

  // The marketplace and the due date written into the message itself — the
  // parsing is covered in parser/taskDetails.test.ts; what matters here is
  // that both reach the task, and that the client is told what was read.
  it("puts the marketplace and due date from the message onto the task", async () => {
    vi.mocked(clientRepository.findByChatId).mockResolvedValue({ id: "client-1", name: "Forensic Files" } as any);
    vi.mocked(taskRepository.create).mockResolvedValue({ id: "task-1" } as any);
    const channels = fakeChannels();

    await handleIncomingTaskMessage({
      source: "whatsapp_group",
      chatId: "1234@g.us",
      text: "task: listing not live on flipkart due 20/8/2026",
      channels,
    });

    expect(taskRepository.create).toHaveBeenCalledWith({
      source: "whatsapp_group",
      sourceRef: "1234@g.us",
      // The date phrase is gone; the marketplace word stays in the sentence.
      description: "listing not live on flipkart",
      clientName: "Forensic Files",
      assignee: null,
      marketplace: "flipkart",
      dueDate: new Date("2026-08-20T00:00:00.000Z"),
    });
  });

  it("repeats back what it read, so a misread date is caught by whoever typed it", async () => {
    vi.mocked(clientRepository.findByChatId).mockResolvedValue({ id: "client-1", name: "Forensic Files" } as any);
    vi.mocked(taskRepository.create).mockResolvedValue({ id: "task-1" } as any);
    const channels = fakeChannels();

    await handleIncomingTaskMessage({
      source: "whatsapp_group",
      chatId: "1234@g.us",
      text: "task: amazon claim pending due 20/8/2026",
      channels,
    });

    expect(channels.periskope.sendMessage).toHaveBeenCalledWith(
      "1234@g.us",
      "✅ Got it, logged — Amazon, due 20 Aug 2026."
    );
  });

  // A message naming neither must behave exactly as it always did.
  it("leaves a message with no marketplace or date completely alone", async () => {
    vi.mocked(clientRepository.findByChatId).mockResolvedValue({ id: "client-1", name: "Forensic Files" } as any);
    vi.mocked(taskRepository.create).mockResolvedValue({ id: "task-1" } as any);
    const channels = fakeChannels();

    await handleIncomingTaskMessage({
      source: "whatsapp_group",
      chatId: "1234@g.us",
      text: "task: fix the listing images",
      channels,
    });

    expect(taskRepository.create).toHaveBeenCalledWith({
      source: "whatsapp_group",
      sourceRef: "1234@g.us",
      description: "fix the listing images",
      clientName: "Forensic Files",
      assignee: null,
    });
    expect(channels.periskope.sendMessage).toHaveBeenCalledWith("1234@g.us", "✅ Got it, logged.");
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
    expect(channels.periskope.sendMessage).not.toHaveBeenCalled();
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
    expect(channels.periskope.sendMessage).not.toHaveBeenCalled();
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
      source: "whatsapp_group",
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
    // Nothing logged a moment ago, unless a test says otherwise — see the
    // redelivery case at the bottom of this file.
    vi.mocked(taskRepository.findDuplicateOf).mockReset();
    vi.mocked(taskRepository.findDuplicateOf).mockResolvedValue(null);
    vi.mocked(clientRepository.findByChatId).mockReset();
    vi.mocked(clientRepository.findByChatId).mockResolvedValue({ id: "client-1", name: "BagsGuru" } as any);
    vi.mocked(clientRepository.ensureGroupLinked).mockReset();
    vi.mocked(clientRepository.ensureGroupLinked).mockResolvedValue(null);
    vi.mocked(employeeRepository.list).mockReset();
    vi.mocked(employeeRepository.list).mockResolvedValue([SHIVANI] as any);
    vi.mocked(taskNoteRepository.create).mockReset();
    vi.mocked(taskNoteRepository.create).mockResolvedValue({} as any);
    vi.mocked(employeeRepository.findByName).mockReset();
    vi.mocked(employeeRepository.findByName).mockResolvedValue({ ...SHIVANI, active: true } as any);
    vi.mocked(unrecognizedMessageRepository.create).mockReset();
    vi.mocked(configOptionRepository.list).mockReset();
    vi.mocked(configOptionRepository.list).mockResolvedValue(MARKETPLACE_OPTIONS as any);
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

    const sends = channels.periskope.sendMessage.mock.calls;
    const toEmployee = sends.find((call) => call[0] === "919876543210");
    expect(toEmployee).toBeDefined();
    expect(toEmployee![1]).toContain("Shivani");
    expect(toEmployee![1]).toContain("fix the listing");
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
    expect(created.assignee).toBeNull();
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
    channels.periskope.sendMessage.mockRejectedValue(new Error("Periskope down"));

    const task = await handleIncomingTaskMessage({
      source: "whatsapp_group",
      chatId: "120363409833141766@g.us",
      text: "task: fix the listing @919876543210",
      channels,
    });

    expect(task).toMatchObject({ id: "task-1" });
  });

  // A tagged number that matches nobody used to fail in silence: the task
  // appeared unassigned with the number still in its text, which reads
  // exactly like nobody having tagged anyone. Twice that was reported as the
  // feature being broken, when the number simply wasn't saved against
  // anyone.
  it("leaves a note when a tagged number belongs to no employee", async () => {
    vi.mocked(taskRepository.create).mockResolvedValue({ id: "task-9", description: "x" } as any);

    await handleIncomingTaskMessage({
      source: "whatsapp_group",
      chatId: "group-1@g.us",
      text: "task: Need account details @918733071033",
      channels: fakeChannels(),
    });

    expect(taskNoteRepository.create).toHaveBeenCalledTimes(1);
    const note = vi.mocked(taskNoteRepository.create).mock.calls[0][0];
    expect(note.taskId).toBe("task-9");
    expect(note.body).toContain("no employee has it saved");
  });

  it("leaves no note when the tag did match somebody", async () => {
    vi.mocked(taskRepository.create).mockResolvedValue({ id: "task-10", description: "x" } as any);

    await handleIncomingTaskMessage({
      source: "whatsapp_group",
      chatId: "group-1@g.us",
      text: "task: fix the listing @919876543210",
      channels: fakeChannels(),
    });

    expect(taskNoteRepository.create).not.toHaveBeenCalled();
  });

  // Nothing number-shaped in the message at all: silence is correct here,
  // and a note on every ordinary request would be noise.
  it("leaves no note when nothing was tagged", async () => {
    vi.mocked(taskRepository.create).mockResolvedValue({ id: "task-11", description: "x" } as any);

    await handleIncomingTaskMessage({
      source: "whatsapp_group",
      chatId: "group-1@g.us",
      text: "task: fix the listing",
      channels: fakeChannels(),
    });

    expect(taskNoteRepository.create).not.toHaveBeenCalled();
  });

  // A webhook redelivery either side of a restart, which seenMessages.ts
  // cannot catch — it holds message ids in memory. What the client sees is
  // the part that matters: one message, one reply.
  describe("a message that has already been logged", () => {
    beforeEach(() => {
      vi.mocked(clientRepository.findByChatId).mockResolvedValue({
        id: "client-1",
        name: "Forensic Files",
      } as any);
      vi.mocked(taskRepository.findDuplicateOf).mockResolvedValue({
        id: "task-first",
        description: "reduce stock to 5",
      } as any);
    });

    it("does not create a second task", async () => {
      await handleIncomingTaskMessage({
        source: "whatsapp_group",
        chatId: "group-1@g.us",
        text: "task: reduce stock to 5",
        channels: fakeChannels(),
      });

      expect(taskRepository.create).not.toHaveBeenCalled();
    });

    it("does not acknowledge the client a second time", async () => {
      const channels = fakeChannels();

      await handleIncomingTaskMessage({
        source: "whatsapp_group",
        chatId: "group-1@g.us",
        text: "task: reduce stock to 5",
        channels,
      });

      expect(channels.periskope.sendMessage).not.toHaveBeenCalled();
    });

    it("gives back the task that was already made", async () => {
      const task = await handleIncomingTaskMessage({
        source: "whatsapp_group",
        chatId: "group-1@g.us",
        text: "task: reduce stock to 5",
        channels: fakeChannels(),
      });

      expect(task).toMatchObject({ id: "task-first" });
    });

    // Matched on the same chat and the same wording — the description the
    // task would have been created with, after the due date and any tagged
    // number have been taken out of it.
    it("looks for the duplicate in the chat it arrived from", async () => {
      await handleIncomingTaskMessage({
        source: "whatsapp_group",
        chatId: "group-1@g.us",
        text: "task: reduce stock to 5",
        channels: fakeChannels(),
      });

      expect(taskRepository.findDuplicateOf).toHaveBeenCalledWith(
        { description: "reduce stock to 5", sourceRef: "group-1@g.us" },
        expect.any(Date)
      );
    });
  });
});

// A client has one employee on them, and their work arrives already on that
// person instead of sitting unassigned until somebody triages it. The rule
// itself is covered in clientAssignment.test.ts; what these check is that
// intake applies it, and what happens when it meets the tagged-number path.
describe("handleIncomingTaskMessage — assigning from the client's employee", () => {
  const ASSIGNED = { name: "Asha", phone: "919000000011" };

  function clientAssignedTo(employee: { name: string; active: boolean } | null) {
    return { id: "client-1", name: "BagsGuru", assignedEmployee: employee } as any;
  }

  beforeEach(() => {
    vi.mocked(taskRepository.create).mockReset();
    vi.mocked(taskRepository.create).mockResolvedValue({
      id: "task-1",
      description: "fix the listing",
      clientName: "BagsGuru",
      dueDate: null,
    } as any);
    vi.mocked(taskRepository.findDuplicateOf).mockReset();
    vi.mocked(taskRepository.findDuplicateOf).mockResolvedValue(null);
    vi.mocked(clientRepository.findByChatId).mockReset();
    vi.mocked(clientRepository.ensureGroupLinked).mockReset();
    vi.mocked(clientRepository.ensureGroupLinked).mockResolvedValue(null);
    vi.mocked(employeeRepository.list).mockReset();
    vi.mocked(employeeRepository.list).mockResolvedValue([ASSIGNED] as any);
    // How notifyAssignee finds the number to send the "this is yours" alert
    // to — it looks the assignee's name back up rather than being handed a
    // phone. Deactivated staff never reach it: intake stops assigning them
    // before it gets this far.
    vi.mocked(employeeRepository.findByName).mockReset();
    vi.mocked(employeeRepository.findByName).mockResolvedValue({ ...ASSIGNED, active: true } as any);
    vi.mocked(taskNoteRepository.create).mockReset();
    vi.mocked(taskNoteRepository.create).mockResolvedValue({} as any);
    vi.mocked(unrecognizedMessageRepository.create).mockReset();
    vi.mocked(configOptionRepository.list).mockReset();
    vi.mocked(configOptionRepository.list).mockResolvedValue(MARKETPLACE_OPTIONS as any);
  });

  it("assigns a new task to the employee the client is on", async () => {
    vi.mocked(clientRepository.findByChatId).mockResolvedValue(
      clientAssignedTo({ name: "Asha", active: true })
    );

    await handleIncomingTaskMessage({
      source: "whatsapp_group",
      chatId: "120363409833141766@g.us",
      text: "task: fix the listing",
      channels: fakeChannels(),
    });

    expect(taskRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ clientName: "BagsGuru", assignee: "Asha" })
    );
  });

  // Being given work tells you so, the same way a tagged number always has.
  // Without this the first anyone hears of it is the 9am reminder.
  it("tells that employee the task is theirs", async () => {
    vi.mocked(clientRepository.findByChatId).mockResolvedValue(
      clientAssignedTo({ name: "Asha", active: true })
    );
    const channels = fakeChannels();

    await handleIncomingTaskMessage({
      source: "whatsapp_group",
      chatId: "120363409833141766@g.us",
      text: "task: fix the listing",
      channels,
    });

    const toEmployee = channels.periskope.sendMessage.mock.calls.find((call) => call[0] === "919000000011");
    expect(toEmployee).toBeDefined();
    expect(toEmployee![1]).toContain("Asha");
    expect(toEmployee![1]).toContain("fix the listing");
  });

  // The one that decides which of the two features wins. A number in the
  // message is somebody saying who *this* task is for, which is more specific
  // than the client's standing rule — so it has to beat it, not lose to it.
  it("lets a number tagged in the message beat the client's employee", async () => {
    vi.mocked(clientRepository.findByChatId).mockResolvedValue(
      clientAssignedTo({ name: "Asha", active: true })
    );
    vi.mocked(employeeRepository.list).mockResolvedValue([
      ASSIGNED,
      { name: "Bharat", phone: "919000000022" },
    ] as any);
    vi.mocked(employeeRepository.findByName).mockResolvedValue({
      name: "Bharat",
      phone: "919000000022",
      active: true,
    } as any);

    await handleIncomingTaskMessage({
      source: "whatsapp_group",
      chatId: "120363409833141766@g.us",
      text: "task: fix the listing @919000000022",
      channels: fakeChannels(),
    });

    expect(taskRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ description: "fix the listing", assignee: "Bharat" })
    );
  });

  // Assigned to somebody deactivated, a task is invisible to every member on
  // the board and appears in no reminder. Unassigned, anyone can see it.
  it("leaves the task unassigned when the client's employee has been deactivated", async () => {
    vi.mocked(clientRepository.findByChatId).mockResolvedValue(
      clientAssignedTo({ name: "Asha", active: false })
    );
    const channels = fakeChannels();

    await handleIncomingTaskMessage({
      source: "whatsapp_group",
      chatId: "120363409833141766@g.us",
      text: "task: fix the listing",
      channels,
    });

    expect(taskRepository.create).toHaveBeenCalledWith(expect.objectContaining({ assignee: null }));
    expect(channels.periskope.sendMessage.mock.calls.some((call) => call[0] === "919000000011")).toBe(false);
  });

  // Every client on the system the day this shipped, and the state the board
  // behaved in before the column existed at all.
  it("leaves the task unassigned when nobody is on the client", async () => {
    vi.mocked(clientRepository.findByChatId).mockResolvedValue(clientAssignedTo(null));

    await handleIncomingTaskMessage({
      source: "whatsapp_group",
      chatId: "120363409833141766@g.us",
      text: "task: fix the listing",
      channels: fakeChannels(),
    });

    expect(taskRepository.create).toHaveBeenCalledWith(expect.objectContaining({ assignee: null }));
  });
});
