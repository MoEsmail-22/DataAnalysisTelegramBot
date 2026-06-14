"use strict";

const crypto = require("crypto");
const fs = require("fs");

let syncInterval = null;
let cachedToken = null;

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SHEETS_BASE_URL = "https://sheets.googleapis.com/v4/spreadsheets";

const HEADER_ALIASES = {
  primary_phone: [
    "\u0627\u0644\u0647\u0627\u062a\u0641 001",
    "phone",
    "primary_phone",
  ],
  customer_name: [
    "\u0627\u0633\u0645 \u0627\u0644\u0639\u0645\u064a\u0644",
    "customer_name",
    "name",
  ],
  duplicate_phone: [
    "\u0627\u0644\u0647\u0627\u062a\u0641 0012",
    "duplicate_phone",
  ],
  phone_2: ["\u0627\u0644\u0647\u0627\u062a\u0641 002", "phone_2", "phone2"],
  phone_3: ["\u0627\u0644\u0647\u0627\u062a\u0641 003", "phone_3", "phone3"],
  governorate: [
    "\u0627\u0644\u0645\u062d\u0627\u0641\u0638\u0629",
    "governorate",
    "city",
  ],
  zone: ["zone", "Zone"],
  area: ["area", "Area"],
  address_1: [
    "\u0627\u0644\u0639\u0646\u0648\u0627\u0646",
    "address",
    "address_1",
  ],
  address_2: ["\u0627\u0644\u0639\u0646\u0648\u0627\u0646 02", "address_2"],
  address_3: ["\u0627\u0644\u0639\u0646\u0648\u0627\u0646 03", "address_3"],
  notes: [
    "\u0645\u0644\u062d\u0648\u0638\u0629",
    "\u0627\u0644\u0645\u0644\u0627\u062d\u0638\u0627\u062a",
    "notes",
    "note",
  ],
};

function base64Url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function normalizeHeader(value) {
  return String(value || "").trim();
}

function normalizeArabicDigits(value) {
  const arabic = "٠١٢٣٤٥٦٧٨٩";
  const persian = "۰۱۲۳۴۵۶۷۸۹";

  return String(value || "").replace(/[٠-٩۰-۹]/g, (digit) => {
    const arabicIndex = arabic.indexOf(digit);
    if (arabicIndex !== -1) return String(arabicIndex);
    return String(persian.indexOf(digit));
  });
}

function cleanText(value) {
  return (
    String(value || "")
      .replace(/\s+/g, " ")
      .trim() || null
  );
}

function normalizePhone(value) {
  if (value === undefined || value === null) return null;

  let phone = normalizeArabicDigits(value).replace(/[^\d+]/g, "");
  if (!phone) return null;

  if (phone.startsWith("+20")) {
    phone = `0${phone.slice(3)}`;
  } else if (phone.startsWith("20") && phone.length === 12) {
    phone = `0${phone.slice(2)}`;
  } else if (phone.startsWith("1") && phone.length === 10) {
    phone = `0${phone}`;
  }

  return phone;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function makeHash(profile) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(profile))
    .digest("hex");
}

function loadCredentials() {
  let credentials;

  if (process.env.GOOGLE_SHEETS_CREDENTIALS_PATH) {
    credentials = JSON.parse(
      fs.readFileSync(process.env.GOOGLE_SHEETS_CREDENTIALS_PATH, "utf8"),
    );
  } else if (process.env.GOOGLE_SHEETS_CREDENTIALS_BASE64) {
    credentials = JSON.parse(
      Buffer.from(
        process.env.GOOGLE_SHEETS_CREDENTIALS_BASE64,
        "base64",
      ).toString("utf8"),
    );
  } else if (process.env.GOOGLE_SHEETS_CREDENTIALS) {
    credentials = JSON.parse(process.env.GOOGLE_SHEETS_CREDENTIALS);
  } else {
    throw new Error(
      "Google credentials are missing. Set GOOGLE_SHEETS_CREDENTIALS_PATH, GOOGLE_SHEETS_CREDENTIALS_BASE64, or GOOGLE_SHEETS_CREDENTIALS.",
    );
  }

  credentials.private_key = String(credentials.private_key || "")
    .replace(/\\n/g, "\n")
    .trim();

  if (!credentials.client_email || !credentials.private_key) {
    throw new Error(
      "Google credentials must include client_email and private_key.",
    );
  }

  crypto.createPrivateKey(credentials.private_key);
  return credentials;
}

function createJwt(credentials) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: credentials.client_email,
    scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
    aud: TOKEN_URL,
    exp: now + 3600,
    iat: now,
  };
  const unsigned = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(payload))}`;
  const signature = crypto.sign(
    "RSA-SHA256",
    Buffer.from(unsigned),
    credentials.private_key,
  );
  return `${unsigned}.${base64Url(signature)}`;
}

async function getAccessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.accessToken;
  }

  const credentials = loadCredentials();
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion: createJwt(credentials),
  });
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      `${data.error || response.status}: ${data.error_description || data.error || response.statusText}`,
    );
  }

  cachedToken = {
    accessToken: data.access_token,
    expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000,
  };
  return cachedToken.accessToken;
}

async function googleGet(path) {
  const accessToken = await getAccessToken();
  const response = await fetch(`${SHEETS_BASE_URL}${path}`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error?.message || response.statusText);
  }

  return data;
}

function mapRow(headers, row) {
  const mapped = {};

  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    const index = headers.findIndex((header) =>
      aliases.some(
        (alias) =>
          normalizeHeader(alias).toLowerCase() ===
          normalizeHeader(header).toLowerCase(),
      ),
    );
    mapped[field] = index === -1 ? "" : row[index];
  }

  return mapped;
}

function isEmptySheetRow(row) {
  return !row || row.every((cell) => String(cell || "").trim() === "");
}

function findHeaderRow(rows) {
  const headerWords = [
    "\u0627\u0644\u0647\u0627\u062a\u0641 001",
    "\u0627\u0633\u0645 \u0627\u0644\u0639\u0645\u064a\u0644",
    "\u0627\u0644\u0645\u062d\u0627\u0641\u0638\u0629",
    "\u0627\u0644\u0639\u0646\u0648\u0627\u0646",
  ];
  const index = rows.findIndex((row) =>
    headerWords.some((word) =>
      row.some((cell) => normalizeHeader(cell) === word),
    ),
  );

  return index === -1 ? 0 : index;
}

function shouldStoreRawData() {
  return String(process.env.STORE_RAW_DATA || "").toLowerCase() === "true";
}

function sheetsRowsToProfiles(rows) {
  const headerRowIndex = findHeaderRow(rows);
  const headers = (rows[headerRowIndex] || []).map(normalizeHeader);
  const dataRows = rows.slice(headerRowIndex + 1);
  const storeRawData = shouldStoreRawData();

  return dataRows
    .filter((row) => !isEmptySheetRow(row))
    .map((row) => {
      const mapped = mapRow(headers, row);
      const phones = unique([
        normalizePhone(mapped.primary_phone),
        normalizePhone(mapped.duplicate_phone),
        normalizePhone(mapped.phone_2),
        normalizePhone(mapped.phone_3),
      ]);
      const addresses = unique([
        cleanText(mapped.address_1),
        cleanText(mapped.address_2),
        cleanText(mapped.address_3),
      ]);

      const profile = {
        customerName: cleanText(mapped.customer_name),
        primaryPhone: normalizePhone(mapped.primary_phone),
        duplicateCheckPhone: normalizePhone(mapped.duplicate_phone),
        phones,
        governorate: cleanText(mapped.governorate),
        zone: cleanText(mapped.zone),
        area: cleanText(mapped.area),
        addresses,
        notes: cleanText(mapped.notes),
        rawData: storeRawData
          ? Object.fromEntries(
              headers.map((header, index) => [header, row[index] || ""]),
            )
          : {},
      };

      profile.sourceHash = makeHash(profile);
      return profile;
    })
    .filter(
      (profile) =>
        profile.customerName ||
        profile.phones.length ||
        profile.addresses.length,
    );
}

async function getSpreadsheetTabNames(sheetId) {
  const data = await googleGet(
    `/${encodeURIComponent(sheetId)}?fields=sheets.properties.title`,
  );
  return (data.sheets || [])
    .map((sheet) => sheet.properties?.title)
    .filter(Boolean);
}

function buildSheetRange(sheetName) {
  const name = String(sheetName || "Data").replace(/'/g, "''");
  return `'${name}'`;
}

async function readGoogleSheet(sheetId, sheetName) {
  const tabs = await getSpreadsheetTabNames(sheetId);

  if (!tabs.includes(sheetName)) {
    return {
      profiles: [],
      rowsCount: 0,
      message: `Google Sheet tab "${sheetName}" not found. Available tabs: ${tabs.join(", ")}`,
    };
  }

  const range = encodeURIComponent(buildSheetRange(sheetName));
  const data = await googleGet(
    `/${encodeURIComponent(sheetId)}/values/${range}?majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE`,
  );
  const rows = data.values || [];

  if (rows.length === 0) {
    return {
      profiles: [],
      rowsCount: 0,
      message: `Google Sheet tab "${sheetName}" is empty.`,
    };
  }

  const profiles = sheetsRowsToProfiles(rows);
  return {
    profiles,
    rowsCount: Math.max(rows.length - 1, 0),
    message: `Parsed ${profiles.length} profiles from Google Sheet tab "${sheetName}".`,
  };
}

function shouldDeleteMissingRows() {
  return (
    String(process.env.GOOGLE_SYNC_DELETE_MISSING || "true").toLowerCase() !==
    "false"
  );
}

async function syncGoogleSheet(upsertFunction, deleteMissingFunction) {
  if (!process.env.GOOGLE_SHEET_ID) {
    console.warn("GOOGLE_SHEET_ID not set. Google Sheets sync is disabled.");
    return { status: "disabled", message: "GOOGLE_SHEET_ID not configured" };
  }

  try {
    const sheetId = process.env.GOOGLE_SHEET_ID;
    const sheetName = process.env.GOOGLE_SHEET_NAME || "Data";

    console.log(`Syncing from Google Sheet: ${sheetId}, range: ${sheetName}`);
    const result = await readGoogleSheet(sheetId, sheetName);

    if (!result.profiles || result.profiles.length === 0) {
      return {
        status: "success",
        message: result.message || "Google Sheet is empty",
        profilesCount: 0,
      };
    }

    await upsertFunction(result.profiles);

    let deletedCount = 0;
    // The background deletion remains fully active here:
    if (shouldDeleteMissingRows() && deleteMissingFunction) {
      deletedCount = await deleteMissingFunction(
        result.profiles.map((profile) => profile.sourceHash),
      );
    }

    // Server log will still track it for you:
    console.log(
      `Successfully synced ${result.profiles.length} profiles from Google Sheet. Background deleted ${deletedCount} missing profiles.`,
    );

    // The user will only see the total synced profiles text:
    return {
      status: "success",
      message: `Synced ${result.profiles.length} profiles.`,
      profilesCount: result.profiles.length,
      deletedCount,
    };
  } catch (error) {
    console.error("Google Sheets sync failed:", error.message);
    return {
      status: "error",
      message: `Sync failed: ${error.message}`,
    };
  }
}

function startPeriodicSync(
  upsertFunction,
  deleteMissingFunction,
  intervalMinutes = 10,
) {
  if (syncInterval) {
    console.warn("Periodic sync is already running");
    return;
  }

  if (!process.env.GOOGLE_SHEET_ID) {
    console.log(
      "GOOGLE_SHEET_ID not set. Periodic Google Sheets sync disabled.",
    );
    return;
  }

  const intervalMs = intervalMinutes * 60 * 1000;
  console.log(
    `Starting periodic Google Sheets sync every ${intervalMinutes} minutes`,
  );

  syncGoogleSheet(upsertFunction, deleteMissingFunction).catch((error) => {
    console.error("Initial sync failed:", error.message);
  });

  syncInterval = setInterval(() => {
    syncGoogleSheet(upsertFunction, deleteMissingFunction).catch((error) => {
      console.error("Periodic sync failed:", error.message);
    });
  }, intervalMs);

  process.on("SIGINT", stopPeriodicSync);
  process.on("SIGTERM", stopPeriodicSync);
}

function stopPeriodicSync() {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
    console.log("Periodic Google Sheets sync stopped");
  }
}

module.exports = {
  syncGoogleSheet,
  startPeriodicSync,
  stopPeriodicSync,
};
