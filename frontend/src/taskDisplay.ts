import { ConfigOption, Marketplace, TaskStatus } from "./api";

// Only the handful of statuses this frontend knows to color — anything an
// admin adds beyond these falls back to "neutral", since there's no
// meaningful color to guess for an arbitrary new status. Shared by the Tasks
// board and the Client Details screen so a status can't end up a different
// color depending on which screen you're looking at.
const STATUS_COLOR: Record<string, string> = {
  // Where every task starts: nothing has happened to it, so it is the quiet
  // one. "Started" now means somebody has actually picked it up, which is a
  // step forward and reads as one.
  no_action_yet: "neutral",
  started: "info",
  submitted: "info",
  waiting_for_marketplace: "warn",
  waiting_for_client: "warn",
  again_submitted: "info",
  done: "good",
};

export function statusColor(status: TaskStatus): string {
  return STATUS_COLOR[status] ?? "neutral";
}

// "Waiting for Amazon" needs to read "Waiting for Flipkart" etc. depending on
// the task's own marketplace column — same rule the backend uses when it
// composes the WhatsApp update message. Falls back to the raw value for any
// status the option list doesn't (yet) know a label for, e.g. right after an
// admin renames one and the screen hasn't reloaded.
export function statusLabel(
  status: TaskStatus,
  marketplace: Marketplace | null,
  statusOptions: ConfigOption[],
  marketplaceLabels: Record<string, string>
): string {
  if (status === "waiting_for_marketplace") {
    return `Waiting for ${(marketplace && marketplaceLabels[marketplace]) || "Marketplace"}`;
  }
  return statusOptions.find((o) => o.value === status)?.label ?? status;
}
