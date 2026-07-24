// "Waiting for Amazon" needs to read "Waiting for Flipkart" etc. depending on
// the task's own marketplace column — falls back to a generic word when the
// marketplace hasn't been triaged yet, or its label can't be found (e.g. it
// was since deactivated). Status/marketplace labels come from ConfigOption,
// not hardcoded, so admins can rename or add options without a code change.
export function statusLabel(
  status: string,
  marketplace: string | null,
  statusLabels: Record<string, string>,
  marketplaceLabels: Record<string, string>
): string {
  if (status === "waiting_for_marketplace") {
    return `Waiting for ${(marketplace && marketplaceLabels[marketplace]) || "Marketplace"}`;
  }
  return statusLabels[status] ?? status;
}

export function formatDate(date: Date | null): string {
  return date ? date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "Not set";
}

// Fields any WhatsApp update (automatic status notification, or the manual
// Send button) can report on. Deliberately excludes:
//   - the task's creation date — the client already gets an automatic
//     "✅ Got it, logged" message when a task is first created (see
//     taskIntake.ts), so restating when it was created is redundant.
//   - task type — an internal triage category with no meaning to the
//     client receiving the message.
export const SENDABLE_FIELDS = ["status", "marketplace", "assignee", "dueDate"] as const;
export type SendableField = (typeof SENDABLE_FIELDS)[number];

export interface TaskSnapshotSource {
  status: string;
  marketplace: string | null;
  assignee: string | null;
  dueDate: Date | null;
}

// Stored as Task.sentSnapshot (JSON) after every send — what the *next*
// send compares against to work out what's actually new.
export type TaskSnapshot = Partial<Record<SendableField, string | null>>;

function fieldValue(task: TaskSnapshotSource, field: SendableField): string | null {
  if (field === "status") return task.status;
  if (field === "marketplace") return task.marketplace;
  if (field === "assignee") return task.assignee;
  return task.dueDate ? task.dueDate.toISOString() : null; // dueDate
}

// A full snapshot of every sendable field's current value — saved after a
// send so the next comparison starts from exactly what was just told.
export function buildSnapshot(task: TaskSnapshotSource): TaskSnapshot {
  const snapshot: TaskSnapshot = {};
  for (const field of SENDABLE_FIELDS) snapshot[field] = fieldValue(task, field);
  return snapshot;
}

// What the Send button actually sends: fields that differ from the last
// snapshot (or, with no snapshot yet, any field that already has a real
// value worth mentioning) — no manual picking, just what's new since the
// last time someone hit Send for this task.
export function changedFieldsSince(task: TaskSnapshotSource, snapshot: TaskSnapshot | null): SendableField[] {
  return SENDABLE_FIELDS.filter((field) => {
    const current = fieldValue(task, field);
    if (current === null) return false;
    const previous = snapshot ? snapshot[field] ?? null : null;
    return current !== previous;
  });
}

// Joins clause fragments into one sentence — "X", "X and Y", or "X, Y and
// Z" — so reporting several fields at once still reads as one message.
function joinClauses(clauses: string[]): string {
  if (clauses.length <= 1) return clauses[0] ?? "";
  if (clauses.length === 2) return `${clauses[0]} and ${clauses[1]}`;
  return `${clauses.slice(0, -1).join(", ")} and ${clauses[clauses.length - 1]}`;
}

export interface ComposeSendUpdateMessageInput {
  description: string;
  fields: SendableField[];
  status: string;
  marketplace: string | null;
  assignee: string | null;
  dueDate: Date | null;
  statusLabels: Record<string, string>;
  marketplaceLabels: Record<string, string>;
}

// The single template both the automatic status-change notification and
// the manual Send button use — one or more fields, clubbed into one
// sentence, always naming the task first so a client whose WhatsApp
// group/chat covers more than one task knows which one it's about.
export function composeSendUpdateMessage(input: ComposeSendUpdateMessageInput): string {
  const clauses: string[] = [];
  for (const field of input.fields) {
    if (field === "status") {
      clauses.push(`task status changed to ${statusLabel(input.status, input.marketplace, input.statusLabels, input.marketplaceLabels)}`);
    } else if (field === "marketplace") {
      clauses.push(`marketplace set to ${(input.marketplace && input.marketplaceLabels[input.marketplace]) || "not set"}`);
    } else if (field === "assignee") {
      clauses.push(`assigned to ${input.assignee || "no one yet"}`);
    } else {
      clauses.push(`due date set to ${formatDate(input.dueDate)}`); // dueDate
    }
  }
  return `"${input.description}" — ${joinClauses(clauses)}.`;
}
