const crypto = require("crypto");
const XLSX = require("xlsx");

function normalizeHeader(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
}

function normalizePhone(value) {
  if (value === undefined || value === null) return null;
  const phone = String(value).trim().replace(/[^\d+]/g, "");
  return phone || null;
}

function parseNumber(value) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(number) ? number : null;
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function pick(row, names) {
  for (const name of names) {
    if (
      row[name] !== undefined &&
      row[name] !== null &&
      String(row[name]).trim() !== ""
    ) {
      return row[name];
    }
  }
  return null;
}

function makeHash(record) {
  return crypto.createHash("sha256").update(JSON.stringify(record)).digest("hex");
}

function readRows(filePath) {
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];

  if (!sheet) {
    return [];
  }

  return XLSX.utils
    .sheet_to_json(sheet, {
      defval: "",
      raw: false,
    })
    .map((row) => {
      const normalized = {};

      for (const [key, value] of Object.entries(row)) {
        normalized[normalizeHeader(key)] = value;
      }

      return normalized;
    });
}

function parseSalesRecordsFromExcel(filePath) {
  return readRows(filePath)
    .map((row) => {
      const phone = normalizePhone(
        pick(row, [
          "phone",
          "phone_number",
          "customer_phone",
          "mobile",
          "mobile_number",
          "telephone",
        ]),
      );

      const record = {
        externalId:
          String(pick(row, ["id", "customer_id", "client_id", "code"]) || "").trim() ||
          null,
        customerName:
          String(
            pick(row, ["customer_name", "name", "full_name", "client_name"]) || "",
          ).trim() || null,
        phone,
        address:
          String(pick(row, ["address", "customer_address", "location"]) || "").trim() ||
          null,
        purchaseName:
          String(
            pick(row, ["purchase", "purchases", "product", "item", "service"]) || "",
          ).trim() || null,
        purchaseDate: parseDate(
          pick(row, ["purchase_date", "date_of_purchase", "date", "order_date"]),
        ),
        transactionCount:
          parseNumber(
            pick(row, ["number_of_transactions", "transactions", "transaction_count"]),
          ) || 1,
        quantity: parseNumber(pick(row, ["quantity", "qty", "qouinity"])),
        amount: parseNumber(pick(row, ["amount", "total", "price", "value", "paid"])),
        rawData: row,
      };

      record.sourceHash = makeHash(record);
      return record;
    })
    .filter((record) => record.phone || record.externalId || record.customerName);
}

module.exports = {
  parseSalesRecordsFromExcel,
};
