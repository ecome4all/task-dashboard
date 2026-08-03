// <input type="datetime-local"> speaks "2026-08-10T09:00" in the browser's own
// timezone, with no offset. The API wants a real instant, so these two convert
// between the picker's local wall-clock text and an ISO string.

export function toLocalInputValue(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  // Shift by the offset so toISOString() yields local wall-clock time, then
  // trim the seconds and Z the picker won't accept.
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function fromLocalInputValue(value: string): string | null {
  if (!value) return null;
  const d = new Date(value); // parsed as local time, which is what was typed
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// A sensible default to open the picker on: tomorrow at 9am, rather than
// whatever second the button happened to be clicked.
export function defaultFirstRun(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return toLocalInputValue(d.toISOString());
}
