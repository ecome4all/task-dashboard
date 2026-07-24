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
  fields: string[];
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
