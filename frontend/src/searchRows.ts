// Free-text search over a row's own words, shared by the Tasks board and the
// Repeating Tasks screen so the box behaves the same on both.
//
// **Every word typed has to appear somewhere in the row, in any order and in
// any field.** Typing "amezia ads" finds the Amezia ads task whether "Amezia"
// is in the wording or only in the client column. Matching the whole query as
// one substring instead would mean typing the words in the order they happen
// to sit in that row — which is not how anyone searches a board they are
// scanning, and would miss the row above on a technicality.
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
