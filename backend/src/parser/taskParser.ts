const TASK_PREFIX = /^task:\s*/i;

export interface ParsedTask {
  description: string;
}

export function parseTaskMessage(rawText: string): ParsedTask | null {
  if (!TASK_PREFIX.test(rawText)) return null;

  const description = rawText.replace(TASK_PREFIX, "").trim();
  if (!description) return null;

  return { description };
}
