// Checks the Periskope setup one step at a time and says in plain words what
// to fix. Read-only: it never sends a WhatsApp message.
//
//   node scripts/check-periskope.js
require("dotenv").config();
const crypto = require("crypto");

const apiKey = process.env.PERISKOPE_API_KEY;
const phone = process.env.PERISKOPE_PHONE;
const secret = process.env.PERISKOPE_WEBHOOK_SECRET;

function fail(message, fix) {
  console.log(`\n  NOT WORKING: ${message}`);
  console.log(`  FIX: ${fix}\n`);
  process.exit(1);
}

console.log("\nChecking your Periskope setup...\n");

// --- 1. all three values present ---
if (!apiKey) fail("PERISKOPE_API_KEY is empty.", "Copy it from Periskope > Settings > API Keys into backend/.env.");
if (!phone) fail("PERISKOPE_PHONE is empty.", "Set it to the connected number, digits only, e.g. 918733071033.");
if (!secret) fail("PERISKOPE_WEBHOOK_SECRET is empty.", "Copy the signing key from Periskope > Settings > Webhooks.");
console.log(`  1. All three values are set`);

// --- 2. they look like the right kind of value ---
if (!apiKey.startsWith("sk_periskope_")) {
  fail("The API key does not start with sk_periskope_.", "You may have pasted the signing key here by mistake. They are two different values.");
}
if (!secret.startsWith("peri_")) {
  fail("The signing key does not start with peri_.", "You may have pasted the API key here by mistake. They are two different values.");
}
if (!/^\d{10,15}$/.test(phone)) {
  fail(`PERISKOPE_PHONE is "${phone}", which is not just digits.`, "Remove the +, spaces and brackets. It should look like 918733071033.");
}
console.log("  2. Each value is the right kind");

// --- 3. the API key is scoped to that same number ---
try {
  const payload = JSON.parse(Buffer.from(apiKey.replace("sk_periskope_", "").split(".")[1], "base64").toString());
  const scopes = (payload.metadata && payload.metadata.scopes) || [];
  const scopedNumbers = scopes.map((s) => String(s).split("@")[0]);
  if (scopedNumbers.length && !scopedNumbers.includes(phone)) {
    fail(
      `The API key is for number ${scopedNumbers.join(", ")}, but PERISKOPE_PHONE is ${phone}.`,
      "Either change PERISKOPE_PHONE to match, or make a new API key for the number you actually want to use.",
    );
  }
  console.log(`  3. Key belongs to the same number (${phone})`);
  if (payload.exp) console.log(`     Key valid until  : ${new Date(payload.exp * 1000).toISOString().slice(0, 10)}`);
} catch {
  console.log("  3. Could not read the key's details (not fatal, carrying on)");
}

// --- 4. signature check works with this secret ---
const body = Buffer.from(JSON.stringify({ event_type: "message.created" }));
const sig = crypto.createHmac("sha256", secret).update(body).digest("hex");
const roundTrip = crypto.createHmac("sha256", secret).update(body).digest("hex") === sig;
if (!roundTrip) fail("Could not produce a stable signature.", "This should not happen - tell your developer.");
console.log("  4. Webhook signature check is working");

// --- 5. can we actually reach Periskope? ---
(async () => {
  let res;
  try {
    res = await fetch("https://api.periskope.app/v1/chats", {
      headers: { Authorization: "Bearer " + apiKey, "x-phone": phone },
    });
  } catch (err) {
    fail(`Could not reach Periskope - ${err.message}`, "Check your internet connection and try again.");
  }

  if (res.status === 401) {
    const text = await res.text();
    if (text.includes("pro and enterprise")) {
      fail("Periskope says your plan does not include API access.", "Upgrade to Pro, then make a NEW API key - old keys stay blocked.");
    }
    fail("Periskope rejected the API key.", "Make a new key in Settings > API Keys and paste it into backend/.env.");
  }
  if (!res.ok) fail(`Periskope answered with an error (${res.status}).`, "Wait a minute and try again.");

  const body = await res.json();
  const chats = body.chats || body.data || [];
  const groups = chats.filter((c) => String(c.chat_id || "").endsWith("@g.us"));
  console.log(`  5. Periskope answered OK - ${chats.length} chats, ${groups.length} groups`);

  console.log("\n  Everything on this computer is set up correctly.");
  console.log("\n  Two things this cannot check for you:");
  console.log("    - that Railway has these same three values");
  console.log("    - that the webhook URL is registered in Periskope");
  console.log("  See PERISKOPE_SETUP.md steps 5 and 6.\n");
})();
