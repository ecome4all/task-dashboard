// Accepts "task" followed by any of : - = as the separator, with optional
// whitespace on either side -- covers "task:", "task :", "task-", "task -",
// "task=", "task =", etc. People type this by hand on a phone keyboard and
// don't all reach for the same punctuation.
const TASK_PREFIX = /^task\s*[:\-=]\s*/i;

export interface ParsedTask {
  description: string;
}

export function parseTaskMessage(rawText: string): ParsedTask | null {
  if (!TASK_PREFIX.test(rawText)) return null;

  const description = rawText.replace(TASK_PREFIX, "").trim();
  if (!description) return null;

  return { description };
}
