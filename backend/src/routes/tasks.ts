import { Router } from "express";
import { taskRepository } from "../repositories/taskRepository";
import { taskNoteRepository } from "../repositories/taskNoteRepository";
import { configOptionRepository } from "../repositories/configOptionRepository";
import { employeeRepository } from "../repositories/employeeRepository";
import { WhatsAppChannels, resolveAdapterForSource } from "../whatsapp/resolveAdapter";
import {
  composeSendUpdateMessage,
  composeNoteMessage,
  changedFieldsSince,
  buildSnapshot,
  shouldAnnounceStageChange,
  TaskSnapshot,
} from "../services/taskMessages";
import { notifyAssignee } from "../services/assignmentNotice";
import { requireRole } from "../auth/requireRole";
import { taskVisibilityFor, isTaskVisible } from "../services/taskVisibility";
import { clientRepository } from "../repositories/clientRepository";
import type { Request, Response } from "express";

// Deleting a task is the one thing on this router that isn't open to
// everyone: members raise and work tasks, they don't remove them. Same two
// roles that can delete a client.
const MANAGE_ROLES = ["admin", "manager"];

const DUE_DATE_ROLES = ["admin", "manager"];

// Raising a task by hand, rather than it arriving over WhatsApp. Held to the
// same two roles as due dates and repeats: a task typed straight onto the
// board can carry a client, an employee and a deadline that nobody in the
// client's group ever asked for, which is a scheduling decision.
const CREATE_ROLES = ["admin", "manager"];

// source for a task raised on the board that isn't tied to any client chat —
// it has nowhere to send updates back to. Intake's own values
// ("whatsapp_group" / "whatsapp_official") always have a chat behind them.
const MANUAL_SOURCE = "manual";

// A task reached by id that isn't on this person's board is answered as if it
// weren't there at all — the same answer as a wrong id, so the difference
// between "hidden from you" and "doesn't exist" gives nothing away about
// other people's work. See services/taskVisibility.ts for the rule itself.
function hiddenFrom(req: Request, task: { assignee: string | null }): boolean {
  return !isTaskVisible(task, taskVisibilityFor(req.employee));
}

// Every route below that reaches a task by id shares this: load it, and treat
// "not there" and "not yours" identically.
async function loadVisibleTask(req: Request, res: Response) {
  const task = await taskRepository.findById(req.params.id);
  if (!task || hiddenFrom(req, task)) {
    res.status(404).json({ error: "task not found" });
    return null;
  }
  return task;
}

export function createTasksRouter(channels: WhatsAppChannels) {
  const router = Router();

  router.get("/", async (req, res) => {
    const [tasks, noteCounts] = await Promise.all([
      taskRepository.list(taskVisibilityFor(req.employee)),
      taskNoteRepository.countsByTask(),
    ]);
    // The Send button needs to know, per task, whether anything's changed
    // since the last send — computed here rather than trusting the client
    // to track it, since staff on different devices/sessions share one
    // "what's already been told to the client" snapshot.
    res.json(
      tasks.map((task) => ({
        ...task,
        pendingSendFields: changedFieldsSince(task, task.sentSnapshot as TaskSnapshot | null),
        noteCount: noteCounts[task.id] ?? 0,
      }))
    );
  });

  // Raising a task by hand, rather than waiting for one to arrive over
  // WhatsApp — work that came in by phone, in a meeting, or that Ecom4all
  // set itself. Everything the board holds is on the one form (client,
  // platform, type, employee, due date), so a new task doesn't have to be
  // created and then triaged in five separate edits afterwards.
  router.post("/", requireRole(...CREATE_ROLES), async (req, res) => {
    const { description, clientId, assignee, taskType, marketplace, dueDate } = req.body;

    if (typeof description !== "string" || !description.trim()) {
      res.status(400).json({ error: "Write what the task is." });
      return;
    }

    // Same option lists the board's dropdowns read, checked the same way
    // PATCH checks them — a value that isn't a live option would show as a
    // blank cell on every screen afterwards.
    const [taskTypeOptions, marketplaceOptions] = await Promise.all([
      taskType ? configOptionRepository.list("task_type") : Promise.resolve([]),
      marketplace ? configOptionRepository.list("marketplace") : Promise.resolve([]),
    ]);
    if (taskType && !taskTypeOptions.some((o) => o.value === taskType)) {
      res.status(400).json({ error: "invalid taskType" });
      return;
    }
    if (marketplace && !marketplaceOptions.some((o) => o.value === marketplace)) {
      res.status(400).json({ error: "invalid marketplace" });
      return;
    }

    // Task.assignee holds a name, not a link to the Employee row, so a name
    // that belongs to nobody would sit on the board un-droppable and unseen
    // by the person it was meant for.
    if (assignee) {
      const employee = await employeeRepository.findByName(assignee);
      if (!employee || !employee.active) {
        res.status(400).json({ error: "That employee isn't on the list." });
        return;
      }
    }

    let parsedDueDate: Date | null = null;
    if (dueDate) {
      parsedDueDate = new Date(dueDate);
      if (Number.isNaN(parsedDueDate.getTime())) {
        res.status(400).json({ error: "invalid dueDate" });
        return;
      }
    }

    // Where updates on this task go back out to. A client's linked WhatsApp
    // group is the real address — same value intake would have stored had
    // the task arrived from that group, so Send and the automatic stage
    // messages work on it exactly as they do on any other task. A client with
    // only a phone number is messaged 1:1 instead (the adapter adds the chat
    // suffix). With no client at all there's nowhere to send: the task is
    // still a perfectly good task, it just stays internal.
    let source = MANUAL_SOURCE;
    let sourceRef = "";
    let chatName: string | undefined;
    let clientName: string | undefined;
    if (clientId) {
      const client = await clientRepository.findById(clientId);
      if (!client) {
        res.status(400).json({ error: "That client isn't on the list." });
        return;
      }
      clientName = client.name;
      const group = client.whatsappGroups[0];
      if (group) {
        source = "whatsapp_group";
        sourceRef = group.groupId;
        chatName = group.groupName ?? undefined;
      } else if (client.phone) {
        source = "whatsapp_direct";
        sourceRef = client.phone;
      }
    }

    const task = await taskRepository.create({
      source,
      sourceRef,
      chatName,
      clientName,
      description: description.trim(),
      assignee: assignee || null,
      taskType: taskType || null,
      marketplace: marketplace || null,
      dueDate: parsedDueDate,
    });

    // Being given work on the board tells you the same way being given it
    // over WhatsApp does — the alert doesn't depend on how the task got here.
    if (task.assignee) {
      await notifyAssignee(
        task.assignee,
        { description: task.description, clientName: task.clientName, dueDate: task.dueDate },
        channels
      );
    }

    // Nothing has been sent to the client about a task the moment it's made,
    // so every field counts as pending — same shape the board's list gives.
    res.status(201).json({
      ...task,
      pendingSendFields: changedFieldsSince(task, null),
      noteCount: 0,
    });
  });

  // Notes are a running log, not one shared box — see the TaskNote model.
  // Any logged-in employee can read and add; deleting is limited to the
  // person who wrote it (or an admin), so nobody can quietly remove someone
  // else's record of what happened.
  router.get("/:id/notes", async (req, res) => {
    // The task is loaded first purely to answer "are you allowed to read
    // this?" — notes carry the working detail of a task, so they follow the
    // same visibility rule as the task itself.
    if (!(await loadVisibleTask(req, res))) return;
    res.json(await taskNoteRepository.listForTask(req.params.id));
  });

  router.post("/:id/notes", async (req, res) => {
    const { body, sendToWhatsapp } = req.body;
    if (typeof body !== "string" || !body.trim()) {
      res.status(400).json({ error: "body is required" });
      return;
    }

    const task = await loadVisibleTask(req, res);
    if (!task) return;

    const author = await employeeRepository.findById(req.employeeId!);
    if (!author) {
      res.status(403).json({ error: "employee not found" });
      return;
    }

    let note = await taskNoteRepository.create({
      taskId: task.id,
      authorId: author.id,
      authorName: author.name,
      body: body.trim(),
    });

    // Sending is opted into per note — most are internal working detail the
    // client must never see. The note is saved first either way: if the send
    // fails, the writing isn't lost, and sentAt staying null is what tells
    // the screen to show it as unsent rather than claiming success.
    // A task raised on the board with no client chat behind it has nowhere to
    // send to (see MANUAL_SOURCE) — the note is kept, internal, rather than
    // the send being attempted against an empty address.
    if (sendToWhatsapp === true && task.sourceRef) {
      try {
        const whatsapp = resolveAdapterForSource(task.source, channels);
        await whatsapp.sendMessage(task.sourceRef, composeNoteMessage(task.description, note.body));
        note = await taskNoteRepository.markSent(note.id);
      } catch (err) {
        console.error("Failed to send task note to WhatsApp:", err);
      }
    }

    res.status(201).json(note);
  });

  // Removing a task outright. Marking it done is how finished work is
  // closed; this is for the things that were never work — a duplicate, a
  // test, a message that shouldn't have become a task. Without it those sit
  // in the Done list for the life of the system.
  //
  // Admins and managers, matching who can delete a client. Its notes go with
  // it automatically (the relation cascades).
  router.delete("/:id", requireRole(...MANAGE_ROLES), async (req, res) => {
    const task = await taskRepository.findById(req.params.id);
    if (!task) {
      res.status(404).json({ error: "task not found" });
      return;
    }
    await taskRepository.delete(task.id);
    console.log(`[tasks] deleted "${task.description}" (${task.clientName ?? "no client"})`);
    res.status(204).send();
  });

  router.delete("/:id/notes/:noteId", async (req, res) => {
    const note = await taskNoteRepository.findById(req.params.noteId);
    if (!note || note.taskId !== req.params.id) {
      res.status(404).json({ error: "note not found" });
      return;
    }

    const employee = await employeeRepository.findById(req.employeeId!);
    if (!employee || (note.authorId !== employee.id && employee.role !== "admin")) {
      res.status(403).json({ error: "you can only delete your own notes" });
      return;
    }

    await taskNoteRepository.delete(note.id);
    res.status(204).send();
  });

  router.patch("/:id", async (req, res) => {
    const { assignee, status, taskType, marketplace, dueDate } = req.body;

    // Editing follows the same rule as seeing: a member can't change a task
    // that isn't on their board. Checked before any of the validation below,
    // so a rejected edit says nothing about what the task holds.
    const existing = await loadVisibleTask(req, res);
    if (!existing) return;

    // Only fetch the option lists this particular request actually needs —
    // e.g. changing just the assignee needs none of these, and changing
    // just the marketplace doesn't need status/taskType. Each list was
    // being fetched unconditionally on every PATCH, which is 2-3 needless
    // DB round trips (felt as UI lag) for the common case of editing one
    // field at a time. marketplaceOptions is also needed whenever status
    // changes, since the "Waiting for <marketplace>" WhatsApp label below
    // depends on it regardless of whether marketplace itself changed.
    const needStatusOptions = status !== undefined;
    const needTaskTypeOptions = taskType !== undefined && taskType !== null;
    const needMarketplaceOptions = (marketplace !== undefined && marketplace !== null) || status !== undefined;

    const [statusOptions, taskTypeOptions, marketplaceOptions] = await Promise.all([
      needStatusOptions ? configOptionRepository.list("status") : Promise.resolve([]),
      needTaskTypeOptions ? configOptionRepository.list("task_type") : Promise.resolve([]),
      needMarketplaceOptions ? configOptionRepository.list("marketplace") : Promise.resolve([]),
    ]);

    if (status !== undefined && !statusOptions.some((o) => o.value === status)) {
      res.status(400).json({ error: "invalid status" });
      return;
    }
    if (taskType !== undefined && taskType !== null && !taskTypeOptions.some((o) => o.value === taskType)) {
      res.status(400).json({ error: "invalid taskType" });
      return;
    }
    if (marketplace !== undefined && marketplace !== null && !marketplaceOptions.some((o) => o.value === marketplace)) {
      res.status(400).json({ error: "invalid marketplace" });
      return;
    }

    let parsedDueDate: Date | null | undefined;
    if (dueDate !== undefined) {
      // Only an admin or manager can set a task's due date — members can
      // edit everything else on a task, but not this.
      const employee = await employeeRepository.findById(req.employeeId!);
      if (!employee || !DUE_DATE_ROLES.includes(employee.role)) {
        res.status(403).json({ error: "only an admin or manager can set the due date" });
        return;
      }
      if (dueDate === null) {
        parsedDueDate = null;
      } else {
        const parsed = new Date(dueDate);
        if (Number.isNaN(parsed.getTime())) {
          res.status(400).json({ error: "invalid dueDate" });
          return;
        }
        parsedDueDate = parsed;
      }
    }

    // How the task stood before this edit. Both notifications below turn on
    // something having actually changed rather than merely being present in
    // the request: re-picking a dropdown at the value it already had, or
    // editing a due date, must not message anyone. This is the row the
    // visibility check above already loaded, so it costs no extra query.
    const previousAssignee = existing.assignee;
    const previousStatus = existing.status;

    const task = await taskRepository.update(req.params.id, {
      assignee,
      status,
      taskType,
      marketplace,
      dueDate: parsedDueDate,
    });

    // The whole point of the feature: the moment someone is put on a task,
    // they get a WhatsApp message about it, rather than finding out at
    // tomorrow morning's reminder or the next time they open the dashboard.
    // Best-effort and never throws — the assignment is already saved above.
    if (assignee !== undefined && task.assignee && task.assignee !== previousAssignee) {
      await notifyAssignee(
        task.assignee,
        { description: task.description, clientName: task.clientName, dueDate: task.dueDate },
        channels
      );
    }

    // Every stage change is announced back to the group, not just "done" —
    // "the group gets an automatic message every time a request's stage
    // changes" is what was promised, and for a client the point of the
    // system is watching their request move without having to ask.
    //
    // Guarded on the stage having actually moved. Without that, editing a
    // due date or re-picking the same status would message the client again
    // saying nothing had changed, which is worse than not messaging at all.
    //
    // Uses the same composer as the manual Send button, forced to the single
    // "status" field, so both paths stay worded identically. Best-effort:
    // the change is already saved above, and a WhatsApp failure (network
    // blip, bad chat_id, Periskope outage) must not fail the request or
    // crash the server — an uncaught rejection here would take down the
    // whole process, not just this one notification.
    //
    // DISABLE_AUTO_STATUS_UPDATES exists because this is the one feature
    // that messages a client on someone else's schedule. If a group ever
    // finds it noisy it can be switched off in the hosting settings without
    // a deploy, and the manual Send button still covers everything.
    //
    // currentSnapshot tracks what the response's pendingSendFields should
    // reflect — it starts as the snapshot already on the task and gets the
    // status merged in below on a successful send, so a later manual Send
    // doesn't restate what was already announced. A failed send leaves it
    // untouched, so the change stays pending on the Send button rather than
    // being silently lost.
    let currentSnapshot = task.sentSnapshot as TaskSnapshot | null;
    const stageChanged =
      // A task raised on the board with no client chat behind it has nobody
      // to announce to — see MANUAL_SOURCE.
      Boolean(task.sourceRef) &&
      shouldAnnounceStageChange({
        statusInRequest: status !== undefined,
        previousStatus,
        newStatus: task.status,
        disabled: process.env.DISABLE_AUTO_STATUS_UPDATES === "true",
      });
    if (stageChanged) {
      try {
        const whatsapp = resolveAdapterForSource(task.source, channels);
        const statusLabels = Object.fromEntries(statusOptions.map((o) => [o.value, o.label]));
        const marketplaceLabels = Object.fromEntries(marketplaceOptions.map((o) => [o.value, o.label]));
        const message = composeSendUpdateMessage({
          description: task.description,
          fields: ["status"],
          status: task.status,
          marketplace: task.marketplace,
          assignee: task.assignee,
          dueDate: task.dueDate,
          statusLabels,
          marketplaceLabels,
        });
        await whatsapp.sendMessage(task.sourceRef, message);
        // Merge just the status field into the existing snapshot, so a
        // later manual Send doesn't restate a status change that was
        // already announced automatically here.
        currentSnapshot = { ...currentSnapshot, status: task.status };
        await taskRepository.updateSnapshot(task.id, currentSnapshot);
      } catch (err) {
        console.error("Failed to send WhatsApp status update:", err);
      }
    }

    res.json({ ...task, pendingSendFields: changedFieldsSince(task, currentSnapshot) });
  });

  // Manual send: unlike the automatic status-change notification above,
  // this is for telling a client about anything else on a task. No field
  // picking — it automatically works out what's changed since the last
  // send (manual or automatic) for this task and sends exactly that.
  router.post("/:id/send-update", async (req, res) => {
    const task = await loadVisibleTask(req, res);
    if (!task) return;

    // Raised on the board with no client behind it (see MANUAL_SOURCE): there
    // is no group or number to send to. The button is already disabled for
    // these, so this is the belt-and-braces answer, worded for whoever
    // manages to reach it anyway.
    if (!task.sourceRef) {
      res.status(400).json({ error: "This task has no client WhatsApp group or number, so nothing can be sent." });
      return;
    }

    const fields = changedFieldsSince(task, task.sentSnapshot as TaskSnapshot | null);
    if (fields.length === 0) {
      res.status(400).json({ error: "Nothing new to send since the last update." });
      return;
    }

    const needStatusOptions = fields.includes("status");
    // The "Waiting for <marketplace>" status label depends on the
    // marketplace list too, even if marketplace itself isn't being sent.
    const needMarketplaceOptions = fields.includes("marketplace") || needStatusOptions;

    const [statusOptions, marketplaceOptions] = await Promise.all([
      needStatusOptions ? configOptionRepository.list("status") : Promise.resolve([]),
      needMarketplaceOptions ? configOptionRepository.list("marketplace") : Promise.resolve([]),
    ]);
    const statusLabels = Object.fromEntries(statusOptions.map((o) => [o.value, o.label]));
    const marketplaceLabels = Object.fromEntries(marketplaceOptions.map((o) => [o.value, o.label]));

    const message = composeSendUpdateMessage({
      description: task.description,
      fields,
      status: task.status,
      marketplace: task.marketplace,
      assignee: task.assignee,
      dueDate: task.dueDate,
      statusLabels,
      marketplaceLabels,
    });

    try {
      const whatsapp = resolveAdapterForSource(task.source, channels);
      await whatsapp.sendMessage(task.sourceRef, message);
    } catch (err) {
      console.error("Failed to send manual task update:", err);
      res.status(502).json({ error: "Couldn't send the message. Try again." });
      return;
    }

    await taskRepository.updateSnapshot(task.id, buildSnapshot(task));
    res.json({ sent: true, fields });
  });

  return router;
}
