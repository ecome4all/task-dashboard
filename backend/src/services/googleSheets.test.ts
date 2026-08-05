import { describe, it, expect } from "vitest";
import { normalizePrivateKey, extractSpreadsheetId } from "./googleSheets";

// Not a real key — a short base64-ish body is enough to check the reshaping,
// and no test should carry live credentials.
const BODY = "MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7VJTUt9Us8cKj";
const CANONICAL = `-----BEGIN PRIVATE KEY-----\n${BODY}\n-----END PRIVATE KEY-----\n`;

describe("normalizePrivateKey", () => {
  it("passes a correctly-formed key through unchanged", () => {
    expect(normalizePrivateKey(CANONICAL)).toBe(CANONICAL);
  });

  // How a one-line env var holds it — the form backend/.env uses.
  it("turns literal \\n escapes into real line breaks", () => {
    const oneLine = `-----BEGIN PRIVATE KEY-----\\n${BODY}\\n-----END PRIVATE KEY-----\\n`;
    expect(normalizePrivateKey(oneLine)).toBe(CANONICAL);
  });

  // .env strips the quotes around a value; a hosting dashboard's variables
  // box does not, so they end up inside the key itself.
  it("drops quotes that came along with the paste", () => {
    expect(normalizePrivateKey(`"${CANONICAL}"`)).toBe(CANONICAL);
    expect(normalizePrivateKey(`'${CANONICAL}'`)).toBe(CANONICAL);
  });

  // The production failure this was written for: the base64 body only, every
  // line break flattened, no BEGIN/END lines.
  it("rebuilds a key pasted as the bare body with no header or line breaks", () => {
    expect(normalizePrivateKey(BODY)).toBe(CANONICAL);
  });

  it("rebuilds a key whose line breaks were flattened but kept its header", () => {
    expect(normalizePrivateKey(`-----BEGIN PRIVATE KEY----- ${BODY} -----END PRIVATE KEY-----`)).toBe(
      CANONICAL
    );
  });

  it("re-wraps a long body at 64 characters, as a PEM requires", () => {
    const long = "A".repeat(200);
    const lines = normalizePrivateKey(long).split("\n");
    expect(lines[1]).toHaveLength(64);
    expect(lines.slice(1, -2).every((l) => l.length <= 64)).toBe(true);
    expect(lines.slice(1, -2).join("")).toBe(long);
  });

  // An older key type must not be silently relabelled into one the decoder
  // would then reject.
  it("keeps an RSA key's own header", () => {
    const rsa = `-----BEGIN RSA PRIVATE KEY-----\n${BODY}\n-----END RSA PRIVATE KEY-----\n`;
    expect(normalizePrivateKey(rsa)).toBe(rsa);
  });

  it("ignores leading and trailing whitespace", () => {
    expect(normalizePrivateKey(`\n  ${CANONICAL}  \n`)).toBe(CANONICAL);
  });

  // It can't invent a key that isn't there — and the message has to name the
  // variable, since that's the only clue anyone gets.
  it("fails with a message naming the variable when there's no key in it", () => {
    expect(() => normalizePrivateKey("")).toThrow(/GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY/);
    expect(() => normalizePrivateKey('"   "')).toThrow(/GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY/);
    expect(() => normalizePrivateKey("-----BEGIN PRIVATE KEY----------END PRIVATE KEY-----")).toThrow(
      /GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY/
    );
  });
});

describe("extractSpreadsheetId", () => {
  it("takes the id out of a full edit URL", () => {
    expect(extractSpreadsheetId("https://docs.google.com/spreadsheets/d/1x-tto7tggs_RUH/edit#gid=0")).toBe(
      "1x-tto7tggs_RUH"
    );
  });

  it("accepts a bare id typed in on its own", () => {
    expect(extractSpreadsheetId("  1x-tto7tggs_RUH ")).toBe("1x-tto7tggs_RUH");
  });

  it("returns null for something that isn't a sheet at all", () => {
    expect(extractSpreadsheetId("https://example.com/not/a/sheet")).toBeNull();
  });
});
