import { describe, it, expect } from "vitest";
import { normalizePrivateKey, extractSpreadsheetId, classifySheetError } from "./googleSheets";

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

// Each of these has a completely different answer, and naming the wrong one
// sends staff hunting for a problem that isn't there. Every failure used to
// say "check it's shared" — including the ones where Google was simply busy
// and the sheet was perfect.
describe("classifySheetError", () => {
  it("calls a 403 a sharing problem", () => {
    expect(classifySheetError({ code: 403 })).toBe("not_shared");
    expect(classifySheetError({ response: { status: 403 } })).toBe("not_shared");
  });

  it("calls a 404 a wrong link", () => {
    expect(classifySheetError({ code: 404 })).toBe("not_found");
  });

  // The one that caused the false alarm: a burst of reads, some answered 429.
  it("calls a rate limit or a server error busy, not broken", () => {
    expect(classifySheetError({ code: 429 })).toBe("busy");
    expect(classifySheetError({ code: 500 })).toBe("busy");
    expect(classifySheetError({ response: { status: 503 } })).toBe("busy");
  });

  it("treats a dropped connection as busy — it's worth another go", () => {
    expect(classifySheetError(new Error("socket hang up"))).toBe("busy");
    expect(classifySheetError(new Error("read ECONNRESET"))).toBe("busy");
  });

  // A bad key fails at the token exchange, before any request reaches Sheets,
  // so it arrives with no HTTP status of its own — the exact shape of the
  // outage that took every client's reports down.
  it("recognises a credentials failure with no status on it", () => {
    expect(classifySheetError(new Error("error:1E08010C:DECODER routines::unsupported"))).toBe("credentials");
    expect(classifySheetError(new Error("invalid_grant: account not found"))).toBe("credentials");
  });

  // The shape this version of googleapis actually throws: `code` is a string
  // and the status is on `status`. Reading `code` first meant a 403 matched
  // nothing, so three clients whose sheets were simply never shared were told
  // "couldn't read this sheet" — a message with no cause and no fix in it.
  it("reads the status when the client puts a word in `code`", () => {
    expect(classifySheetError({ code: "ERR_BAD_REQUEST", status: 403 })).toBe("not_shared");
    expect(classifySheetError({ code: "ERR_BAD_REQUEST", response: { status: 404 } })).toBe("not_found");
    expect(classifySheetError({ code: "ERR_BAD_RESPONSE", status: 503 })).toBe("busy");
  });

  it("takes a numeric status given as a string", () => {
    expect(classifySheetError({ code: "403" })).toBe("not_shared");
  });

  // Some failures carry the reason only in the message.
  it("falls back to what the message says", () => {
    expect(classifySheetError(new Error("The caller does not have permission"))).toBe("not_shared");
    expect(classifySheetError(new Error("Requested entity was not found."))).toBe("not_found");
  });

  // A broken key is the whole app's problem, not one client's, and must not
  // be reported as that client's sheet needing sharing.
  it("still calls a credentials failure a credentials failure", () => {
    expect(classifySheetError(new Error("invalid_grant: no permission for this account"))).toBe("credentials");
  });

  it("admits when it doesn't know", () => {
    expect(classifySheetError(new Error("something else entirely"))).toBe("unknown");
    expect(classifySheetError(undefined)).toBe("unknown");
  });
});
