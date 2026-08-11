// Reading the marketplace and the due date out of the task message itself,
// so "task: listing not live on flipkart due 20/8" arrives on the board
// already carrying both instead of waiting for someone to pick them from two
// dropdowns.
//
// Same principle as the tagged-number assignment in employeeMention.ts: the
// message is plain text on every channel, so this needs no provider-specific
// data and works from a group, the official channel and Periskope alike.
// Nothing here can invent a value — an unrecognized marketplace or an
// unreadable date simply isn't set, and the task looks exactly as it did
// before, for someone to fill in by hand.

export interface MarketplaceOption {
  // ConfigOption.value — what actually gets stored on the task.
  value: string;
  label: string;
}

export interface ExtractedTaskDetails {
  // The task text with the due-date phrase taken out. The marketplace word is
  // deliberately left in: "due 20/8" is bookkeeping bolted onto the end of a
  // sentence, but "listing not live on flipkart" *is* the sentence, and
  // cutting the word out of the middle of it leaves nonsense on the board.
  description: string;
  marketplace: string | null;
  dueDate: Date | null;
}

// India runs at a fixed +5:30 with no daylight saving, and every client and
// employee on this system is there — so "today" has to mean today in India
// regardless of what timezone the server happens to be set to. Railway runs
// UTC by default, where a message sent at 2am India time falls on the
// previous day, and "due today" would then arrive already overdue.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

interface CalendarDay {
  year: number;
  month: number; // 1-12, as people write it
  day: number;
}

function istToday(now: Date): CalendarDay {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  return { year: ist.getUTCFullYear(), month: ist.getUTCMonth() + 1, day: ist.getUTCDate() };
}

// Due dates on this system are whole days, never times — the board sets them
// from a date box, which writes midnight UTC. Built the same way here so a
// date typed into WhatsApp and a date picked on the board are the same value,
// and neither shifts a day when it's read back.
function toDueDate({ year, month, day }: CalendarDay): Date | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  // Rejects the dates that don't exist — 31/02 rolls forward to 2 March
  // rather than failing, so the only way to catch it is to read it back.
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }
  return date;
}

const MONTH_NAMES = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

// Long forms first so "january" can't be read as "jan" with "uary" left over.
const MONTH_PATTERN =
  "january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|" +
  "august|aug|september|sept|sep|october|oct|november|nov|december|dec";

function monthNumber(name: string): number {
  const lower = name.toLowerCase();
  const index = MONTH_NAMES.findIndex((month) => month.startsWith(lower.slice(0, 3)));
  return index + 1;
}

// What introduces a date. "by" is included because "by 20/8" is how half the
// deadlines in a WhatsApp group are actually written — it only counts when a
// date-shaped value follows it, so "rejected by amazon" matches nothing.
const DUE_KEYWORD = String.raw`\b(?:due(?:\s+date)?|deadline|by)\b\s*[:\-–]?\s*`;

const RELATIVE_DATE = new RegExp(DUE_KEYWORD + String.raw`(today|tomorrow|tmrw)\b`, "i");
// "20/8", "20-08-2026", "20.8.26" — day first, which is how dates are written
// in India. 8/9 is 8 September, never 9 August.
const NUMERIC_DATE = new RegExp(
  DUE_KEYWORD + String.raw`(\d{1,2})\s*[\/.\-]\s*(\d{1,2})(?:\s*[\/.\-]\s*(\d{2,4}))?\b`,
  "i"
);
// "20 Aug", "20th August 2026", "20 of August"
const DAY_MONTH_DATE = new RegExp(
  DUE_KEYWORD + String.raw`(\d{1,2})(?:st|nd|rd|th)?\s*(?:of\s+)?(${MONTH_PATTERN})\.?(?:,?\s*(\d{2,4}))?\b`,
  "i"
);
// "Aug 20", "August 20th 2026"
const MONTH_DAY_DATE = new RegExp(
  DUE_KEYWORD + String.raw`(${MONTH_PATTERN})\.?\s*(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{2,4}))?\b`,
  "i"
);

// A year typed as two digits is this century — "26" is 2026, not 1926.
// Left off entirely, it's this year, unless that has already gone well past,
// in which case the year meant is the next one: "due 5/1" written in December
// is next January, not eleven months ago.
function resolveYear(typed: string | undefined, month: number, day: number, today: CalendarDay): number {
  if (typed) return typed.length <= 2 ? 2000 + Number(typed) : Number(typed);

  const thisYear = toDueDate({ year: today.year, month, day });
  const todayDate = toDueDate(today);
  if (thisYear && todayDate) {
    const monthsBehind = (todayDate.getTime() - thisYear.getTime()) / (30 * 24 * 60 * 60 * 1000);
    if (monthsBehind > 6) return today.year + 1;
  }
  return today.year;
}

export interface DueDateMatch {
  dueDate: Date;
  // The phrase to take out of the description — the whole "due 20/8", not
  // just the date part.
  matched: string;
}

export function findDueDate(text: string, now: Date): DueDateMatch | null {
  const today = istToday(now);

  const relative = text.match(RELATIVE_DATE);
  if (relative) {
    const days = relative[1].toLowerCase() === "today" ? 0 : 1;
    const base = toDueDate(today);
    if (base) {
      return { dueDate: new Date(base.getTime() + days * 24 * 60 * 60 * 1000), matched: relative[0] };
    }
  }

  // Month names before numbers: "due 20 Aug 2026" would otherwise be half-read
  // by neither, and a written month is never ambiguous about day-vs-month.
  const dayMonth = text.match(DAY_MONTH_DATE);
  if (dayMonth) {
    const day = Number(dayMonth[1]);
    const month = monthNumber(dayMonth[2]);
    const dueDate = toDueDate({ year: resolveYear(dayMonth[3], month, day, today), month, day });
    if (dueDate) return { dueDate, matched: dayMonth[0] };
  }

  const monthDay = text.match(MONTH_DAY_DATE);
  if (monthDay) {
    const month = monthNumber(monthDay[1]);
    const day = Number(monthDay[2]);
    const dueDate = toDueDate({ year: resolveYear(monthDay[3], month, day, today), month, day });
    if (dueDate) return { dueDate, matched: monthDay[0] };
  }

  const numeric = text.match(NUMERIC_DATE);
  if (numeric) {
    const day = Number(numeric[1]);
    const month = Number(numeric[2]);
    if (month >= 1 && month <= 12) {
      const dueDate = toDueDate({ year: resolveYear(numeric[3], month, day, today), month, day });
      if (dueDate) return { dueDate, matched: numeric[0] };
    }
  }

  return null;
}

function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Matched against the live option list rather than a hard-coded set of names,
// so a marketplace an admin adds in Settings is understood from the next
// message on, with nothing to change here.
//
// Whole words only: "amazon" in "amazonbasics" isn't a marketplace mention.
// The generic catch-all option is skipped — "other" turns up in ordinary
// English constantly ("waiting for other details"), and reading that as a
// marketplace would be wrong far more often than right.
export function findMarketplace(text: string, options: MarketplaceOption[]): string | null {
  let best: { value: string; at: number } | null = null;

  for (const option of options) {
    if (option.value === "other") continue;
    // Both the stored value and the label an admin typed: the value is a slug
    // ("own_website"), so its underscores are matched as spaces too.
    const spellings = [option.label, option.value.replace(/_/g, " "), option.value];
    for (const spelling of spellings) {
      const trimmed = spelling.trim();
      if (!trimmed) continue;
      const match = new RegExp(`\\b${escapeForRegex(trimmed)}\\b`, "i").exec(text);
      // The earliest mention in the message wins, not the first option in the
      // list: "flipkart order rejected, not amazon" is about Flipkart.
      if (match && (!best || match.index < best.at)) {
        best = { value: option.value, at: match.index };
      }
    }
  }

  return best?.value ?? null;
}

// Taking the due-date phrase out of the task text. Same rule as the tagged
// number: it addressed *when*, it isn't part of the work, and leaving it in
// would put "due 20/8" on the board and quote it back to the client inside
// every update about the task.
function withoutPhrase(description: string, phrase: string): string {
  const at = description.toLowerCase().indexOf(phrase.toLowerCase());
  if (at < 0) return description;
  const stripped = (description.slice(0, at) + description.slice(at + phrase.length))
    .replace(/\s{2,}/g, " ")
    // A phrase cut off the end usually leaves the punctuation that introduced
    // it behind: "fix the listing, due 20/8" would otherwise end in a comma.
    .replace(/[\s,;|-]+$/, "")
    .trim();
  // "task: due 20/8" — the date was the whole message. Keep the original text
  // rather than putting a blank row on the board; the due date is still set,
  // and staff can see what was actually sent.
  return stripped || description;
}

export function extractTaskDetails(
  description: string,
  marketplaceOptions: MarketplaceOption[],
  now: Date = new Date()
): ExtractedTaskDetails {
  const due = findDueDate(description, now);
  // The marketplace is looked for in the text that's left, so a month name
  // can't be mistaken for one and a marketplace named inside the date phrase
  // isn't counted twice.
  const remaining = due ? withoutPhrase(description, due.matched) : description;

  return {
    description: remaining,
    marketplace: findMarketplace(remaining, marketplaceOptions),
    dueDate: due?.dueDate ?? null,
  };
}
