// Whatever the sheet's own formatted value looks like is used as-is (see
// googleSheets.ts's FORMATTED_VALUE render option) -- except a column that's
// semantically a percentage must always read as one, even if the sheet cell
// wasn't formatted as a percentage and came back as a bare number.
const PERCENT_COLUMN_PATTERN = /acos|%/i;

// The two columns that split total sales between ads and organic. Unlike
// every other percentage column in these sheets, these are frequently left
// unformatted, so the cell comes back as the raw fraction Sheets stores —
// "0.105819879" where the sheet means 10.58%.
//
// Suffixing that gives the client "Ad Sales %: 0.105819879%", which is not
// a wrong-looking number so much as an unreadable one. Scoped to this pair
// rather than applied to every percentage column: Acos is written "58.53%"
// in every sheet seen, and a bare "0.5" in an Acos cell is far more likely
// to mean half a percent than half the account.
const FRACTION_COLUMN_PATTERN = /(ads?|organic)\s*sales\s*%/i;

// A fraction of the whole, as opposed to a number already scaled to 100.
// "0.894180121" is 89.42%; "89.42" is already 89.42%. 1 counts as the
// fraction — a month where every sale was organic writes it as "1", and
// reading that as 1% would be the worst of the three readings.
function isFraction(value: number): boolean {
  return value >= 0 && value <= 1;
}

export function ensurePercentSuffix(label: string, value: string): string {
  if (!PERCENT_COLUMN_PATTERN.test(label)) return value;

  const trimmed = value.trim();
  if (trimmed.endsWith("%")) return value;

  if (FRACTION_COLUMN_PATTERN.test(label)) {
    const asNumber = Number(trimmed.replace(/,/g, ""));
    if (trimmed !== "" && !Number.isNaN(asNumber) && isFraction(asNumber)) {
      // Two decimals, with trailing zeros dropped — the sheets' own
      // percentage formatting, so a converted cell reads the same as one
      // that was formatted properly.
      return `${Number((asNumber * 100).toFixed(2))}%`;
    }
  }

  return `${value}%`;
}
