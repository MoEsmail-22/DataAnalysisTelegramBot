"use strict";

const crypto = require("crypto");
const fs = require("fs");
const { google } = require("googleapis");

let syncInterval = null;

const HEADER_ALIASES = {
  primary_phone: ["الهاتف 001", "phone", "primary_phone"],
  customer_name: ["اسم العميل", "customer_name", "name"],
  duplicate_phone: ["الهاتف 0012", "duplicate_phone"],
  phone_2: ["الهاتف 002", "phone_2", "phone2"],
  phone_3: ["الهاتف 003", "phone_3", "phone3"],
  governorate: ["المحافظة", "governorate", "city"],
  zone: ["zone", "Zone"],
  area: ["area", "Area"],
  address_1: ["العنوان", "address", "address_1"],
  address_2: ["العنوان 02", "address_2"],
  address_3: ["العنوان 03", "address_3"],
  notes: ["ملحوظة", "الملاحظات", "notes", "note"],
};

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
  return String(value || "").replace(/\s+/g, " ").trim() || null;
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
  return crypto.createHash("sha256").update(JSON.stringify(profile)).digest("hex");
}

function parseCredentialsJson(rawValue) {
  const trimmed = String(rawValue || "").trim();
  if (!trimmed) return null;

  if (trimmed.startsWith("{")) {
    return JSON.parse(trimmed);
  }

  if (fs.existsSync(trimmed)) {
    return JSON.parse(fs.readFileSync(trimmed, "utf8"));
  }

  throw new Error(
    "Google credentials value is not JSON and is not an existing file path.",
  );
}

function normalizeCredentials(credentials) {
  if (!credentials?.client_email || !credentials?.private_key) {
    throw new Error(
      "Google credentials must include client_email and private_key.",
    );
  }

  credentials.private_key = String(credentials.private_key)
    .replace(/\\n/g, "\n")
    .trim();

  try {
    crypto.createPrivateKey(credentials.private_key);
  } catch (error) {
    throw new Error(
      "Google private_key is not a valid private key. Generate a new service account JSON key.",
    );
  }

  return credentials;
}

function loadCredentials() {
  if (process.env.GOOGLE_SHEETS_CREDENTIALS_BASE64) {
    const decoded = Buffer.from(
      process.env.GOOGLE_SHEETS_CREDENTIALS_BASE64,
      "base64",
    ).toString("utf8");
    return normalizeCredentials(JSON.parse(decoded));
  }

  if (process.env.GOOGLE_SHEETS_CREDENTIALS_PATH) {
    return normalizeCredentials(parseCredentialsJson(process.env.GOOGLE_SHEETS_CREDENTIALS_PATH));
  }

  if (process.env.GOOGLE_SHEETS_CREDENTIALS) {
    return normalizeCredentials(parseCredentialsJson(process.env.GOOGLE_SHEETS_CREDENTIALS));
  }

  throw new Error(
    "Google Sheets credentials are not configured. Set GOOGLE_SHEETS_CREDENTIALS_BASE64, GOOGLE_SHEETS_CREDENTIALS_PATH, or GOOGLE_SHEETS_CREDENTIALS.",
  );
}

function initializeSheets() {
  const credentials = loadCredentials();
  const auth = new google.auth.JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });

  return google.sheets({ version: "v4", auth });
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
  const headerWords = ["الهاتف 001", "اسم العميل", "المحافظة", "العنوان"];
  const index = rows.findIndex((row) =>
    headerWords.some((word) => row.some((cell) => normalizeHeader(cell) === word)),
  );

  return index === -1 ? 0 : index;
}

function sheetsRowsToProfiles(rows) {
  const headerRowIndex = findHeaderRow(rows);
  const headers = (rows[headerRowIndex] || []).map(normalizeHeader);
  const dataRows = rows.slice(headerRowIndex + 1);

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
        rawData: Object.fromEntries(
          headers.map((header, index) => [header, row[index] || ""]),
        ),
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

async function getSpreadsheetTabNames(sheetsAPI, sheetId) {
  const response = await sheetsAPI.spreadsheets.get({ spreadsheetId: sheetId });
  return (response.data.sheets || [])
    .map((sheet) => sheet.properties?.title)
    .filter(Boolean);
}

function buildSheetRange(sheetName) {
  if (!sheetName) return "";
  if (sheetName.includes("!")) return sheetName;

  const normalizedName = sheetName.replace(/'/g, "''");
  return `'${normalizedName}'`;
}

async function readGoogleSheet(sheetsAPI, sheetId, sheetName) {
  const tabs = await getSpreadsheetTabNames(sheetsAPI, sheetId);

  if (!tabs.includes(sheetName)) {
    return {
      profiles: [],
      rowsCount: 0,
      tabNames: tabs,
      message: `Google Sheet tab "${sheetName}" not found. Available tabs: ${tabs.join(", ")}`,
    };
  }

  const response = await sheetsAPI.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: buildSheetRange(sheetName),
  });

  const rows = response.data.values || [];
  if (rows.length === 0) {
    return {
      profiles: [],
      rowsCount: 0,
      tabNames: tabs,
      message: `Google Sheet tab "${sheetName}" is empty.`,
    };
  }

  const profiles = sheetsRowsToProfiles(rows);

  return {
    profiles,
    rowsCount: Math.max(rows.length - 1, 0),
    tabNames: tabs,
    message: `Parsed ${profiles.length} profiles from Google Sheet tab "${sheetName}".`,
  };
}

async function syncGoogleSheet(upsertFunction) {
  if (!process.env.GOOGLE_SHEET_ID) {
    console.warn("GOOGLE_SHEET_ID not set. Google Sheets sync is disabled.");
    return { status: "disabled", message: "GOOGLE_SHEET_ID not configured" };
  }

  try {
    const sheetsAPI = initializeSheets();
    const sheetId = process.env.GOOGLE_SHEET_ID;
    const sheetName = process.env.GOOGLE_SHEET_NAME || "Data";

    console.log(`Syncing from Google Sheet: ${sheetId}, range: ${sheetName}`);

    const result = await readGoogleSheet(sheetsAPI, sheetId, sheetName);

    if (!result.profiles || result.profiles.length === 0) {
      return {
        status: "success",
        message: result.message || "Google Sheet is empty",
        profilesCount: 0,
      };
    }

    await upsertFunction(result.profiles);

    console.log(
      `Successfully synced ${result.profiles.length} profiles from Google Sheet`,
    );
    return {
      status: "success",
      message: `Synced ${result.profiles.length} profiles from Google Sheet`,
      profilesCount: result.profiles.length,
    };
  } catch (error) {
    console.error("Google Sheets sync failed:", error.message);
    return {
      status: "error",
      message: `Sync failed: ${error.message}`,
    };
  }
}

function startPeriodicSync(upsertFunction, intervalMinutes = 10) {
  if (syncInterval) {
    console.warn("Periodic sync is already running");
    return;
  }

  if (!process.env.GOOGLE_SHEET_ID) {
    console.log("GOOGLE_SHEET_ID not set. Periodic Google Sheets sync disabled.");
    return;
  }

  const intervalMs = intervalMinutes * 60 * 1000;
  console.log(`Starting periodic Google Sheets sync every ${intervalMinutes} minutes`);

  syncGoogleSheet(upsertFunction).catch((error) => {
    console.error("Initial sync failed:", error.message);
  });

  syncInterval = setInterval(() => {
    syncGoogleSheet(upsertFunction).catch((error) => {
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
