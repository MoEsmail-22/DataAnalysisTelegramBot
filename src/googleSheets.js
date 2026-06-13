"use strict";

const crypto = require("crypto");
const fs = require("fs");
const { google } = require("googleapis");

/**
 * Google Sheets Sync Module
 * Reads customer data from Google Sheets and syncs to database
 */

let syncInterval = null;

/**
 * Initialize Google Sheets API client
 * Expects GOOGLE_SHEETS_CREDENTIALS as JSON string in env
 * or GOOGLE_SHEETS_CREDENTIALS_PATH pointing to a JSON file.
 */
function initializeSheets() {
  const rawCredentials =
    process.env.GOOGLE_SHEETS_CREDENTIALS ||
    process.env.GOOGLE_SHEETS_CREDENTIALS_PATH;

  if (!rawCredentials) {
    throw new Error(
      "Google Sheets credentials are not configured. " +
        "Set GOOGLE_SHEETS_CREDENTIALS to the full JSON content of your service account key file, or set GOOGLE_SHEETS_CREDENTIALS_PATH to a key file path.",
    );
  }

  let credentialsJson = rawCredentials.trim();
  let credentials;

  if (!credentialsJson.startsWith("{")) {
    if (!fs.existsSync(credentialsJson)) {
      throw new Error(
        "GOOGLE_SHEETS_CREDENTIALS_PATH does not point to an existing file. " +
          "Use a valid file path or set GOOGLE_SHEETS_CREDENTIALS to the JSON content.",
      );
    }

    credentialsJson = fs.readFileSync(credentialsJson, "utf8");
  }

  try {
    credentials = JSON.parse(credentialsJson);
  } catch (error) {
    throw new Error(
      "GOOGLE_SHEETS_CREDENTIALS is not valid JSON. " +
        "It should be the full JSON content of your service account key file, or the file at GOOGLE_SHEETS_CREDENTIALS_PATH should contain valid JSON.",
    );
  }

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });

  return google.sheets({ version: "v4", auth });
}

/**
 * Normalize header text (handles both Arabic and English)
 */
function normalizeHeader(value) {
  return String(value || "").trim();
}

/**
 * Normalize Arabic/Persian digits to English
 */
function normalizeArabicDigits(value) {
  const arabic = "٠١٢٣٤٥٦٧٨٩";
  const persian = "۰۱۲۳۴۵۶۷۸۹";

  return String(value || "").replace(/[٠-٩۰-۹]/g, (digit) => {
    const arabicIndex = arabic.indexOf(digit);
    if (arabicIndex !== -1) return String(arabicIndex);
    return String(persian.indexOf(digit));
  });
}

/**
 * Clean and normalize text
 */
function cleanText(value) {
  return (
    String(value || "")
      .replace(/\s+/g, " ")
      .trim() || null
  );
}

/**
 * Normalize phone numbers (handles multiple formats)
 */
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

/**
 * Get unique values from array
 */
function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

/**
 * Create hash of profile for change detection
 */
function makeHash(profile) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(profile))
    .digest("hex");
}

/**
 * Header aliases (same as Excel parser for consistency)
 */
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
  notes: ["ملحوظة", "notes", "note"],
};

/**
 * Map a row of values to customer profile fields
 */
function mapRow(headers, row) {
  const mapped = {};

  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    const index = headers.findIndex((header) =>
      aliases.some(
        (alias) =>
          normalizeHeader(alias).toLowerCase() === header.toLowerCase(),
      ),
    );

    mapped[field] = index === -1 ? "" : row[index];
  }

  return mapped;
}

/**
 * Convert Google Sheets rows to customer profiles
 */
function sheetsRowsToProfiles(rows, headers) {
  return rows
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

/**
 * Get all sheet tab names for a spreadsheet
 */
async function getSpreadsheetTabNames(sheetsAPI, sheetId) {
  const response = await sheetsAPI.spreadsheets.get({ spreadsheetId: sheetId });
  return (response.data.sheets || [])
    .map((sheet) => sheet.properties?.title)
    .filter(Boolean);
}

/**
 * Read customer data from Google Sheet
 */
async function readGoogleSheet(sheetsAPI, sheetId, sheetName) {
  try {
    const response = await sheetsAPI.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: sheetName,
    });

    const rows = response.data.values || [];
    if (rows.length === 0) {
      const tabs = await getSpreadsheetTabNames(sheetsAPI, sheetId);
      console.log(
        `Google Sheet tab "${sheetName}" is empty or not found. Available tabs: ${tabs.join(", ")}`,
      );
      return [];
    }

    // First row is header
    const headers = rows[0].map(normalizeHeader);
    const dataRows = rows.slice(1);

    return sheetsRowsToProfiles(dataRows, headers);
  } catch (error) {
    console.error("Error reading Google Sheet:", error.message);
    throw error;
  }
}

/**
 * Main sync function - reads Google Sheet and upserts to database
 */
async function syncGoogleSheet(upsertFunction) {
  if (!process.env.GOOGLE_SHEET_ID) {
    console.warn(
      "GOOGLE_SHEET_ID not set. Google Sheets sync is disabled. " +
        "Set GOOGLE_SHEET_ID to enable sync.",
    );
    return { status: "disabled", message: "GOOGLE_SHEET_ID not configured" };
  }

  try {
    const sheetsAPI = initializeSheets();
    const sheetId = process.env.GOOGLE_SHEET_ID;
    const sheetName = process.env.GOOGLE_SHEET_NAME || "Data";

    console.log(`Syncing from Google Sheet: ${sheetId}, range: ${sheetName}`);

    const profiles = await readGoogleSheet(sheetsAPI, sheetId, sheetName);

    if (profiles.length === 0) {
      return {
        status: "success",
        message: "Google Sheet is empty",
        profilesCount: 0,
      };
    }

    // Upsert to database
    await upsertFunction(profiles);

    console.log(
      `Successfully synced ${profiles.length} profiles from Google Sheet`,
    );
    return {
      status: "success",
      message: `Synced ${profiles.length} profiles from Google Sheet`,
      profilesCount: profiles.length,
    };
  } catch (error) {
    console.error("Google Sheets sync failed:", error.message);
    return {
      status: "error",
      message: `Sync failed: ${error.message}`,
    };
  }
}

/**
 * Start periodic sync (every N minutes)
 */
function startPeriodicSync(upsertFunction, intervalMinutes = 10) {
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

  // Run immediately on start
  syncGoogleSheet(upsertFunction).catch((error) => {
    console.error("Initial sync failed:", error.message);
  });

  // Then run periodically
  syncInterval = setInterval(() => {
    syncGoogleSheet(upsertFunction).catch((error) => {
      console.error("Periodic sync failed:", error.message);
    });
  }, intervalMs);

  // Make sure we clean up on exit
  process.on("SIGINT", stopPeriodicSync);
  process.on("SIGTERM", stopPeriodicSync);
}

/**
 * Stop periodic sync
 */
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
