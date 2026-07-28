// Whatever the sheet's own formatted value looks like is used as-is (see
// googleSheets.ts's FORMATTED_VALUE render option) -- except a column that's
// semantically a percentage must always read as one, even if the sheet cell
// wasn't formatted as a percentage and came back as a bare number.
const PERCENT_COLUMN_PATTERN = /acos|%/i;

export function ensurePercentSuffix(label: string, value: string): string {
  if (!PERCENT_COLUMN_PATTERN.test(label)) return value;
  return value.trim().endsWith("%") ? value : `${value}%`;
}
