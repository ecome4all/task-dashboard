import { describe, it, expect, vi, beforeEach } from "vitest";
import { runDueRecurringTasks } from "./scheduler";
import { recurringTaskRepository } from "../repositories/recurringTaskRepository";
import { taskRepository } from "../repositories/taskRepository";
import { configOptionRepository } from "../repositories/configOptionRepository";
import { employeeRepository } from "../repositories/employeeRepository";
import { WhatsAppAdapter } from "../whatsapp/whatsappAdapter";
import { WhatsAppChannels } from "../whatsapp/resolveAdapter";

vi.mock("../db", () => ({ prisma: { employee: { findMany: vi.fn() }, task: { findMany: vi.fn() } } }));
vi.mock("../repositories/recurringTaskRepository", () => ({
  recurringTaskRepository: { due: vi.fn(), claim: vi.fn(), releaseClaim: vi.fn(), recordTask: vi.fn() },
}));
vi.mock("../repositories/taskRepository", () => ({
  taskRepository: { openTaskFor: vi.fn(), findDuplicateOf: vi.fn(), create: vi.fn() },
}));
vi.mock("../repositories/configOptionRepository", () => ({ configOptionRepository: { list: vi.fn() } }));
vi.mock("../repositories/clientRepository", () => ({ clientRepository: { listWithReportSheet: vi.fn() } }));
vi.mock("../repositories/employeeRepository", () => ({ employeeRepository: { findByName: vi.fn() } }));
// Only the report round touches this, and it pulls in googleapis.
vi.mock("./weeklyReportPreview", () => ({ buildReport: vi.fn() }));

const NOW = new Date("2026-08-19T03:30:00Z");

function fakeChannels(): WhatsAppChannels & { periskope: { sendMessage: ReturnType<typeof vi.fn> } } {
  const adapter = { sendMessage: vi.fn().mockResolvedValue(undefined) } satisfies WhatsAppAdapter;
  return { periskope: adapter };
}

function repeat(overrides: Record<string, unknown> = {}) {
  return {
    id: "repeat-1",
    source: "whatsapp_group",
    sourceRef: "120363408314108823@g.us",
    chatName: "DMGU",
    description: "Ads Optimise",
    clientName: "Dhwani Grug Udhyog",
    assignee: "Jayvant",
    taskType: "ads",
    marketplace: "amazon",
    frequency: "weekly",
    nextRunAt: new Date("2026-08-19T03:30:00Z"),
    lastRunAt: new Date("2026-08-12T03:30:00Z"),
    lastTaskId: "task-last-week",
    active: true,
    ...overrides,
  } as any;
}

describe("runDueRecurringTasks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(recurringTaskRepository.claim).mockResolvedValue(true);
    vi.mocked(recurringTaskRepository.recordTask).mockResolvedValue({} as any);
    vi.mocked(taskRepository.findDuplicateOf).mockResolvedValue(null);
    vi.mocked(configOptionRepository.list).mockResolvedValue([
      { value: "no_action_yet", label: "No Action Yet" },
    ] as any);
    vi.mocked(employeeRepository.findByName).mockResolvedValue({
      name: "Jayvant",
      active: true,
      phone: "919978988619",
    } as any);
  });

  // The whole point of the change: the client was seeing a second copy of
  // work that was already sitting on the board untouched.
  describe("when the task it made last time is still open", () => {
    const stillOpen = {
      id: "task-last-week",
      description: "Ads Optimise",
      clientName: "Dhwani Grug Udhyog",
      status: "no_action_yet",
      dueDate: null,
      createdAt: new Date("2026-08-12T03:30:00Z"),
    };

    beforeEach(() => {
      vi.mocked(recurringTaskRepository.due).mockResolvedValue([repeat()]);
      vi.mocked(taskRepository.openTaskFor).mockResolvedValue(stillOpen as any);
    });

    it("creates nothing", async () => {
      const created = await runDueRecurringTasks(NOW, fakeChannels());

      expect(taskRepository.create).not.toHaveBeenCalled();
      expect(created).toBe(0);
    });

    it("reminds the person holding it instead", async () => {
      const channels = fakeChannels();
      await runDueRecurringTasks(NOW, channels);

      expect(channels.periskope.sendMessage).toHaveBeenCalledTimes(1);
      const [to, message] = channels.periskope.sendMessage.mock.calls[0];
      expect(to).toBe("919978988619");
      expect(message).toContain("still open");
      expect(message).toContain("*Ads Optimise*");
      expect(message).toContain("Open since: 7 days ago");
    });

    // The turn genuinely happened. Leaving the clock where it was would make
    // every tick from now on fire this repeat again.
    it("still moves the clock on to next week", async () => {
      await runDueRecurringTasks(NOW, fakeChannels());

      expect(recurringTaskRepository.claim).toHaveBeenCalledTimes(1);
      expect(recurringTaskRepository.releaseClaim).not.toHaveBeenCalled();
      const [, , , nextRunAt] = vi.mocked(recurringTaskRepository.claim).mock.calls[0];
      expect(nextRunAt.toISOString()).toBe("2026-08-26T03:30:00.000Z");
    });

    // Matters on the fallback path, where the repeat had nothing recorded and
    // the open task was found by its wording — from now on it takes the
    // precise route rather than matching text again.
    it("records the task it found", async () => {
      await runDueRecurringTasks(NOW, fakeChannels());
      expect(recurringTaskRepository.recordTask).toHaveBeenCalledWith("repeat-1", "task-last-week");
    });

    it("says nothing when nobody is on the task, and still creates nothing", async () => {
      vi.mocked(recurringTaskRepository.due).mockResolvedValue([repeat({ assignee: null })]);
      const channels = fakeChannels();

      await runDueRecurringTasks(NOW, channels);

      expect(channels.periskope.sendMessage).not.toHaveBeenCalled();
      expect(taskRepository.create).not.toHaveBeenCalled();
    });

    // A WhatsApp failure must not put the clock back and make the repeat
    // fire again on the next tick five minutes later.
    it("does not retry the run when the reminder fails to send", async () => {
      const channels = fakeChannels();
      channels.periskope.sendMessage.mockRejectedValue(new Error("provider down"));

      await runDueRecurringTasks(NOW, channels);

      expect(recurringTaskRepository.releaseClaim).not.toHaveBeenCalled();
      expect(taskRepository.create).not.toHaveBeenCalled();
    });
  });

  describe("when last time's task was finished", () => {
    beforeEach(() => {
      vi.mocked(recurringTaskRepository.due).mockResolvedValue([repeat()]);
      // Nothing outstanding — the work needs doing again this week.
      vi.mocked(taskRepository.openTaskFor).mockResolvedValue(null);
      vi.mocked(taskRepository.create).mockResolvedValue({
        id: "task-this-week",
        description: "Ads Optimise",
        clientName: "Dhwani Grug Udhyog",
        dueDate: null,
        assignee: "Jayvant",
      } as any);
    });

    it("creates the new task, carrying the triage across", async () => {
      const created = await runDueRecurringTasks(NOW, fakeChannels());

      expect(created).toBe(1);
      expect(taskRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          description: "Ads Optimise",
          clientName: "Dhwani Grug Udhyog",
          assignee: "Jayvant",
          taskType: "ads",
          marketplace: "amazon",
        })
      );
    });

    it("tells the assignee it is theirs", async () => {
      const channels = fakeChannels();
      await runDueRecurringTasks(NOW, channels);

      const [, message] = channels.periskope.sendMessage.mock.calls[0];
      expect(message).toContain("a new task is yours");
    });

    it("records the new task so next week can check it", async () => {
      await runDueRecurringTasks(NOW, fakeChannels());
      expect(recurringTaskRepository.recordTask).toHaveBeenCalledWith("repeat-1", "task-this-week");
    });

    // Repeats used to create tasks with no due date at all, so they never
    // turned red on the board and never counted as late in the morning
    // reminder — both give up before comparing anything when the date is
    // empty. Asserted by parts rather than against a fixed timestamp: the
    // rule is "the day it lands" in whatever timezone the server runs in,
    // and a test that hard-codes one would pass only on that machine.
    it("makes it due on the day it lands", async () => {
      await runDueRecurringTasks(NOW, fakeChannels());

      const { dueDate } = vi.mocked(taskRepository.create).mock.calls[0][0] as { dueDate: Date };
      expect(dueDate.getFullYear()).toBe(NOW.getFullYear());
      expect(dueDate.getMonth()).toBe(NOW.getMonth());
      expect(dueDate.getDate()).toBe(NOW.getDate());
    });

    // A due date on this board is a day, never a time — the Tasks screen and
    // the reminder both compare by day, and a task made at nine in the
    // morning must not read as due "09:00".
    it("dates it to the whole day rather than the moment it ran", async () => {
      await runDueRecurringTasks(NOW, fakeChannels());

      const { dueDate } = vi.mocked(taskRepository.create).mock.calls[0][0] as { dueDate: Date };
      expect([dueDate.getHours(), dueDate.getMinutes(), dueDate.getSeconds()]).toEqual([0, 0, 0]);
      expect(dueDate.getMilliseconds()).toBe(0);
    });

    // The backend was down over this repeat's turn and is only now catching
    // up. The task appears today, so today is the day the person holding it
    // can act on — dating it to the run that was missed would put it on the
    // board already red, for a delay that was ours and not theirs.
    it("uses the day it appears, not a run that was missed", async () => {
      const missed = new Date("2026-08-12T03:30:00Z");
      vi.mocked(recurringTaskRepository.due).mockResolvedValue([repeat({ nextRunAt: missed })]);

      await runDueRecurringTasks(NOW, fakeChannels());

      const { dueDate } = vi.mocked(taskRepository.create).mock.calls[0][0] as { dueDate: Date };
      expect(dueDate.getDate()).toBe(NOW.getDate());
      expect(dueDate.getDate()).not.toBe(missed.getDate());
    });
  });

  it("leaves a repeat alone when another pass already claimed it", async () => {
    vi.mocked(recurringTaskRepository.due).mockResolvedValue([repeat()]);
    vi.mocked(recurringTaskRepository.claim).mockResolvedValue(false);

    await runDueRecurringTasks(NOW, fakeChannels());

    expect(taskRepository.openTaskFor).not.toHaveBeenCalled();
    expect(taskRepository.create).not.toHaveBeenCalled();
  });

  // One repeat blowing up must not cost the rest of the pass.
  it("carries on with the other repeats when one fails", async () => {
    vi.mocked(recurringTaskRepository.due).mockResolvedValue([
      repeat({ id: "repeat-1" }),
      repeat({ id: "repeat-2", description: "Bleeders-1" }),
    ]);
    vi.mocked(taskRepository.openTaskFor)
      .mockRejectedValueOnce(new Error("database blip"))
      .mockResolvedValueOnce(null);
    vi.mocked(taskRepository.create).mockResolvedValue({ id: "task-2", description: "Bleeders-1" } as any);

    const created = await runDueRecurringTasks(NOW, fakeChannels());

    expect(created).toBe(1);
  });
});
