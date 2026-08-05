// Matching an employee named inside a task message by their phone number.
//
// WhatsApp writes a tagged person into the message body as their number with
// an @ in front — "task: fix the listing @919876543210" — so a tag is just
// text by the time it reaches us, on every channel, with no provider-specific
// mention metadata needed. Numbers typed by hand ("+91 98765 43210") work the
// same way, which is what makes this usable from the official channel too.

export interface MentionableEmployee {
  name: string;
  phone: string | null;
}

export interface EmployeeMention {
  employee: MentionableEmployee;
  // The task text with the number taken out — the number was addressing, not
  // part of the work, and leaving it in would put a raw phone number on the
  // board and into every update message quoted back to the client.
  description: string;
}

// A run of digits long enough to be a phone number, with the punctuation
// people and WhatsApp actually put in one: a leading @ or +, and spaces or
// dashes between groups.
const PHONE_TOKEN = /@?\+?\d[\d\s-]{7,17}\d/g;

// Indian numbers are stored with the country code (see employeeRepository's
// normalizePhone), but get typed both ways — comparing the last 10 digits
// matches "9876543210" against a saved "919876543210" without either side
// having to guess whether a country code is present.
function last10(value: string): string {
  return value.replace(/\D/g, "").slice(-10);
}

// Cheap pre-check so intake only queries the employee table for messages that
// contain something number-shaped at all — most task messages tag nobody.
export function containsPhoneNumber(text: string): boolean {
  // A global regex carries lastIndex between calls, so test() on the shared
  // constant would skip matches on every other call.
  return new RegExp(PHONE_TOKEN.source).test(text);
}

// The first number in the message that belongs to an employee wins — a task
// has one assignee, so a message naming two people still can't split.
// Returns null when nothing matches, which is the normal case: an unmatched
// number is left alone in the description (it could be an order id, or a
// number the client typed for their own reasons).
export function findEmployeeMention(
  description: string,
  employees: MentionableEmployee[]
): EmployeeMention | null {
  const tokens = description.match(PHONE_TOKEN);
  if (!tokens) return null;

  for (const token of tokens) {
    const digits = token.replace(/\D/g, "");
    // Below 10 digits it isn't a mobile number (a date like 12-08-2026 lands
    // here); above 15 it's a run of unrelated numbers the regex joined up,
    // not a single number anyone typed.
    if (digits.length < 10 || digits.length > 15) continue;

    const employee = employees.find((e) => e.phone && last10(e.phone) === last10(token));
    if (employee) return { employee, description: withoutToken(description, token) };
  }

  return null;
}

function withoutToken(description: string, token: string): string {
  const at = description.indexOf(token);
  const stripped = (description.slice(0, at) + description.slice(at + token.length))
    .replace(/\s{2,}/g, " ")
    .trim();
  // "task: @919876543210" — the tag was the whole message. Keep the original
  // text rather than putting a blank row on the board; the assignment still
  // happens, and staff can see what was actually sent.
  return stripped || description;
}
