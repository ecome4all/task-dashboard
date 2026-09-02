// Free-text search over a row's own words, shared by the Tasks board and the
// Repeating Tasks screen so the box behaves the same on both.
//
// **Every word typed has to appear, in any order.** Typing "images cross"
// finds "Images cross check & Update if pending", and so does "cross images".
// Matching the whole query as one substring instead would mean typing the
// words in the order they happen to sit in that task — which is not how
// anyone searches a board they are scanning, and would miss that row on a
// technicality.
//
// Both callers pass the task's own wording and nothing else. Client,
// employee, status and the rest have their own filters beside the box, and
// searching them here too would make a word that happens to be a client name
// return that client's whole list — which reads as the search being broken.
// The signature stays variadic because the rule is about the row's words, not
// about one particular field.
//
// Case is ignored, and so is extra spacing: people paste from WhatsApp.
//
// This filters rows already in the browser. Both screens load their whole
// list and narrow it in memory, so the search covers every row rather than
// just the page on screen. If either screen ever moves to server-side paging,
// this has to move to the server with it or it will quietly search one page.
export function matchesSearch(query: string, ...fields: (string | null | undefined)[]): boolean {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;

  const haystack = fields
    .filter((field): field is string => Boolean(field))
    .join(" ")
    .toLowerCase();

  return terms.every((term) => haystack.includes(term));
}
