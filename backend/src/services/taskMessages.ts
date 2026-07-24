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

// Fields the Send button can report on — the same six the message composer
// below knows how to phrase.
export const SENDABLE_FIELDS = ["status", "marketplace", "taskType", "assignee", "dueDate", "createdAt"] as const;
export type SendableField = (typeof SENDABLE_FIELDS)[number];

export interface TaskSnapshotSource {
  status: string;
  marketplace: string | null;
  taskType: string | null;
  assignee: string | null;
  dueDate: Date | null;
  createdAt: Date;
}

// Stored as Task.sentSnapshot (JSON) after every send — what the *next*
// send compares against to work out what's actually new.
export type TaskSnapshot = Partial<Record<SendableField, string | null>>;

function fieldValue(task: TaskSnapshotSource, field: SendableField): string | null {
  if (field === "status") return task.status;
  if (field === "marketplace") return task.marketplace;
  if (field === "taskType") return task.taskType;
  if (field === "assignee") return task.assignee;
  if (field === "dueDate") return task.dueDate ? task.dueDate.toISOString() : null;
  return task.createdAt.toISOString(); // createdAt
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

// Joins clause fragments into one natural sentence — "X", "X and Y", or
// "X, Y and Z" — rather than a structured field-by-field list, so sending
// several fields at once still reads like a single message, not a report.
function joinClauses(clauses: string[]): string {
  if (clauses.length <= 1) return clauses[0] ?? "";
  if (clauses.length === 2) return `${clauses[0]} and ${clauses[1]}`;
  return `${clauses.slice(0, -1).join(", ")} and ${clauses[clauses.length - 1]}`;
}

function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

export interface ComposeSendUpdateMessageInput {
  description: string;
  fields: SendableField[];
  status: string;
  marketplace: string | null;
  taskType: string | null;
  assignee: string | null;
  dueDate: Date | null;
  createdAt: Date;
  statusLabels: Record<string, string>;
  marketplaceLabels: Record<string, string>;
  taskTypeLabels: Record<string, string>;
}

// The manual "Send Update" message — any mix of fields, clubbed into one
// natural sentence instead of a structured list.
export function composeSendUpdateMessage(input: ComposeSendUpdateMessageInput): string {
  const clauses: string[] = [];
  for (const field of input.fields) {
    if (field === "status") {
      clauses.push(`status is ${statusLabel(input.status, input.marketplace, input.statusLabels, input.marketplaceLabels)}`);
    } else if (field === "marketplace") {
      clauses.push(`marketplace is ${(input.marketplace && input.marketplaceLabels[input.marketplace]) || "not set"}`);
    } else if (field === "taskType") {
      clauses.push(`type is ${(input.taskType && input.taskTypeLabels[input.taskType]) || "not set"}`);
    } else if (field === "assignee") {
      clauses.push(`assigned to ${input.assignee || "no one yet"}`);
    } else if (field === "dueDate") {
      clauses.push(`due by ${formatDate(input.dueDate)}`);
    } else {
      clauses.push(`created on ${formatDate(input.createdAt)}`); // createdAt
    }
  }
  return `Update on task: ${input.description}.\n${capitalize(joinClauses(clauses))}.`;
}
