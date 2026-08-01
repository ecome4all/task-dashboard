// Checks the Google service account setup, one step at a time, and says in
// plain words what to fix. Read-only: it never writes to any sheet.
//
//   node scripts/check-google-sheets.js
//   node scripts/check-google-sheets.js "<paste a sheet link here>"
require("dotenv").config();

const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;

function fail(message, fix) {
  console.log(`\n  NOT WORKING: ${message}`);
  console.log(`  FIX: ${fix}\n`);
  process.exit(1);
}

console.log("\nChecking your Google setup...\n");

// --- 1. both values present ---
if (!email) fail("GOOGLE_SERVICE_ACCOUNT_EMAIL is empty.", "Add it to backend/.env — see step 6 of the guide.");
if (!privateKey) fail("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY is empty.", "Add it to backend/.env — see step 6 of the guide.");
console.log(`  1. Email found      : ${email}`);

// --- 2. the key looks like a key ---
if (!email.endsWith(".gserviceaccount.com")) {
  fail(
    "That email does not look like a service account email.",
    "It must end in .gserviceaccount.com — you may have pasted your own Gmail address by mistake.",
  );
}
if (!privateKey.includes("BEGIN PRIVATE KEY")) {
  fail(
    "The private key does not contain 'BEGIN PRIVATE KEY'.",
    "Copy the whole value of \"private_key\" from the JSON file, including the BEGIN and END lines.",
  );
}
// The single most common mistake: pasting the key across many real lines
// instead of one line with \n written as a backslash and an n.
if (privateKey.includes("\n") && !privateKey.includes("\\n")) {
  fail(
    "The private key is spread over several real lines.",
    "It must be ONE long line, with \\n written as two characters (a backslash, then an n) — see step 6 of the guide.",
  );
}
if (!privateKey.includes("\\n")) {
  fail("The private key has no \\n in it at all.", "Copy the value exactly as it appears in the JSON file.");
}
console.log("  2. Private key looks right");

// --- 3. Google accepts the key ---
const { google } = require("googleapis");
const auth = new google.auth.GoogleAuth({
  credentials: { client_email: email, private_key: privateKey.replace(/\\n/g, "\n") },
  scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
});

(async () => {
  try {
    const client = await auth.getClient();
    await client.getAccessToken();
    console.log("  3. Google accepted the key");
  } catch (err) {
    fail(
      `Google refused the key — ${err.message}`,
      "The key may be wrong, or deleted in Google Cloud. Make a new key (step 5) and paste it again.",
    );
  }

  // --- 4. can it open a real sheet? (only if one was given) ---
  const link = process.argv[2];
  if (!link) {
    console.log("\n  All good so far.");
    console.log("  To also test a real sheet, run it again with the sheet link:");
    console.log("    node scripts/check-google-sheets.js \"<sheet link>\"\n");
    return;
  }

  const idMatch = link.match(/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  const spreadsheetId = idMatch ? idMatch[1] : link.trim();
  const sheets = google.sheets({ version: "v4", auth });

  try {
    const res = await sheets.spreadsheets.get({ spreadsheetId });
    const tabs = (res.data.sheets || []).map((s) => s.properties.title);
    console.log(`  4. Opened the sheet : ${res.data.properties.title}`);
    console.log(`     Tabs inside it   : ${tabs.join(", ")}`);

    const wanted = ["Daily", "Weekly", "SKU"];
    const missing = wanted.filter((w) => !tabs.some((t) => t.toLowerCase() === w.toLowerCase()));
    if (missing.length) {
      console.log(`\n  Note: the app also needs these tabs: ${missing.join(", ")}`);
      console.log("  Reports for those will come back empty until the tabs exist.");
    } else {
      console.log("     All three tabs the app needs are there.");
    }
    console.log("\n  Everything works.\n");
  } catch (err) {
    if (err.code === 403) {
      fail(
        "Google says permission denied for that sheet.",
        `Open the sheet, click Share, and add ${email} as a Viewer — see step 7 of the guide.`,
      );
    }
    if (err.code === 404) fail("No sheet found at that link.", "Check you copied the whole link from the address bar.");
    fail(`Could not open the sheet — ${err.message}`, "Check the link, and that the sheet is shared with the email above.");
  }
})();
