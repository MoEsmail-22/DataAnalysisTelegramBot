require("dotenv").config();

const fs = require("fs/promises");
const path = require("path");
const TelegramBot = require("node-telegram-bot-api");
const {
  countSalesRecords,
  findCustomerSummary,
  insertSalesRecord,
  pool,
  testConnection,
} = require("./db");
const { parseSalesRecordsFromExcel } = require("./excel");

const { BOT_TOKEN } = process.env;
const adminIds = new Set(
  (process.env.ADMIN_IDS || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean),
);

if (!BOT_TOKEN) {
  console.error(
    "EFATAL: BOT_TOKEN is missing. Create .env and set BOT_TOKEN=...",
  );
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  console.error(
    "EFATAL: DATABASE_URL is missing. Use the PostgreSQL connection string, not the Supabase REST URL.",
  );
  process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const downloadsDir = path.join(__dirname, "..", "downloads");

const keyboard = {
  reply_markup: {
    keyboard: [
      [{ text: "Search" }, { text: "Import Excel" }],
      [{ text: "Stats" }, { text: "Help" }],
    ],
    resize_keyboard: true,
    is_persistent: true,
    one_time_keyboard: false,
    input_field_placeholder: "Choose a shortcut or type phone/ID",
  },
};

const commands = [
  { command: "start", description: "Open the bot menu" },
  { command: "help", description: "Show commands and shortcuts" },
  { command: "myid", description: "Show your Telegram user ID" },
  { command: "import", description: "How to upload an Excel file" },
  { command: "search", description: "Search customer by phone, ID, or name" },
  { command: "stats", description: "Show sales database totals" },
];

function formatMoney(value) {
  return Number(value || 0).toLocaleString("en-US", {
    maximumFractionDigits: 2,
  });
}

function formatCustomerSummary(summary) {
  const purchases = Array.isArray(summary.purchases) ? summary.purchases : [];
  const recentPurchases = purchases.slice(0, 5).map((purchase) => {
    const parts = [
      purchase.purchase_date || "No date",
      purchase.purchase_name || "Purchase",
      purchase.quantity ? `qty ${purchase.quantity}` : null,
      purchase.amount ? `amount ${formatMoney(purchase.amount)}` : null,
    ].filter(Boolean);

    return `- ${parts.join(" | ")}`;
  });

  const lines = [
    "Customer summary:",
    summary.customer_name ? `Name: ${summary.customer_name}` : null,
    summary.phone ? `Phone: ${summary.phone}` : null,
    summary.external_id ? `ID: ${summary.external_id}` : null,
    summary.address ? `Address: ${summary.address}` : null,
    "",
    `Rows found: ${summary.rows_found}`,
    `Transactions: ${summary.total_transactions}`,
    `Total quantity: ${formatMoney(summary.total_quantity)}`,
    `Total amount: ${formatMoney(summary.total_amount)}`,
    summary.first_purchase_date && summary.last_purchase_date
      ? `Purchase dates: ${summary.first_purchase_date} to ${summary.last_purchase_date}`
      : null,
    recentPurchases.length ? "" : null,
    recentPurchases.length ? "Recent purchases:" : null,
    ...recentPurchases,
  ].filter(Boolean);

  return lines.join("\n");
}

function isAdmin(msg) {
  if (adminIds.size === 0) {
    return false;
  }

  return adminIds.has(String(msg.from?.id));
}

async function requireAdmin(msg) {
  if (isAdmin(msg)) {
    return true;
  }

  await bot.sendMessage(
    msg.chat.id,
    [
      "Admin access required.",
      `Your Telegram ID is: ${msg.from?.id}`,
      "Ask the bot owner to add it to ADMIN_IDS in .env.",
    ].join("\n"),
    keyboard,
  );
  return false;
}

function helpText() {
  return [
    "Choose a shortcut or use a command:",
    "",
    "/myid - show your Telegram user ID",
    "/import - upload an Excel file",
    "/search phone_id_or_name - customer sales summary",
    "/stats - count sales records and customers",
    "/help - show this menu",
    "",
    "You can also send a phone, ID, or customer name directly.",
  ].join("\n");
}

async function sendImportHelp(chatId) {
  await bot.sendMessage(
    chatId,
    [
      "Upload an .xlsx, .xls, or .csv file here.",
      "",
      "Supported columns include:",
      "customer_name, phone, address",
      "purchase, purchase_date",
      "number_of_transactions, quantity, amount",
      "id or customer_id are optional",
    ].join("\n"),
    keyboard,
  );
}

async function searchAndReply(chatId, query) {
  const summary = await findCustomerSummary(query);

  if (!summary) {
    await bot.sendMessage(
      chatId,
      "No sales data found for that phone, ID, or name.",
      keyboard,
    );
    return;
  }

  await bot.sendMessage(chatId, formatCustomerSummary(summary), keyboard);
}

bot.setMyCommands(commands).catch((error) => {
  console.error("Failed to set Telegram commands:", error.message);
});

bot.onText(/^\/start$/, async (msg) => {
  await bot.sendMessage(msg.chat.id, helpText(), keyboard);
});

bot.onText(/^\/help$/, async (msg) => {
  await bot.sendMessage(msg.chat.id, helpText(), keyboard);
});

bot.onText(/^\/myid$/, async (msg) => {
  await bot.sendMessage(
    msg.chat.id,
    `Your Telegram ID is: ${msg.from.id}`,
    keyboard,
  );
});

bot.onText(/^\/import$/, async (msg) => {
  if (!(await requireAdmin(msg))) {
    return;
  }

  await sendImportHelp(msg.chat.id);
});

bot.onText(/^\/search(?:\s+(.+))?$/, async (msg, match) => {
  const chatId = msg.chat.id;
  const query = match?.[1]?.trim();

  if (!query) {
    await bot.sendMessage(
      chatId,
      "Send /search followed by a phone or ID.",
      keyboard,
    );
    return;
  }

  try {
    await searchAndReply(chatId, query);
  } catch (error) {
    console.error(error);
    await bot.sendMessage(
      chatId,
      "Search failed. Check the server logs for details.",
      keyboard,
    );
  }
});

bot.onText(/^\/stats$/, async (msg) => {
  if (!(await requireAdmin(msg))) {
    return;
  }

  try {
    const stats = await countSalesRecords();
    await bot.sendMessage(
      msg.chat.id,
      [
        `Sales records: ${stats.total_records}`,
        `Customers: ${stats.total_customers}`,
        `Total amount: ${formatMoney(stats.total_amount)}`,
      ].join("\n"),
      keyboard,
    );
  } catch (error) {
    console.error(error);
    await bot.sendMessage(
      msg.chat.id,
      "Could not load stats. Check the server logs.",
      keyboard,
    );
  }
});

bot.on("document", async (msg) => {
  if (!(await requireAdmin(msg))) {
    return;
  }

  const chatId = msg.chat.id;
  const document = msg.document;
  const fileName = document.file_name || "";
  const ext = path.extname(fileName).toLowerCase();

  if (![".xlsx", ".xls", ".csv"].includes(ext)) {
    await bot.sendMessage(
      chatId,
      "Please upload an Excel file: .xlsx, .xls, or .csv",
    );
    return;
  }

  await fs.mkdir(downloadsDir, { recursive: true });

  let downloadedPath;
  try {
    downloadedPath = await bot.downloadFile(document.file_id, downloadsDir);
    const records = parseSalesRecordsFromExcel(downloadedPath);

    if (records.length === 0) {
      await bot.sendMessage(
        chatId,
        "No usable rows found. Make sure the file has customer, phone, or sales columns.",
      );
      return;
    }

    let imported = 0;
    let skipped = 0;
    for (const record of records) {
      const inserted = await insertSalesRecord(record);
      if (inserted) {
        imported += 1;
      } else {
        skipped += 1;
      }
    }

    await bot.sendMessage(
      chatId,
      `Imported ${imported} sales row(s). Skipped ${skipped} duplicate row(s).`,
    );
  } catch (error) {
    console.error(error);
    await bot.sendMessage(
      chatId,
      "Import failed. Check the server logs for details.",
    );
  } finally {
    if (downloadedPath) {
      await fs.rm(downloadedPath, { force: true });
    }
  }
});

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text?.trim();

  if (!text || text.startsWith("/") || msg.document) {
    return;
  }

  try {
    if (/^help$/i.test(text)) {
      await bot.sendMessage(chatId, helpText(), keyboard);
      return;
    }

    if (/^import excel$/i.test(text)) {
      if (!(await requireAdmin(msg))) {
        return;
      }

      await sendImportHelp(chatId);
      return;
    }

    if (/^search$/i.test(text)) {
      await bot.sendMessage(
        chatId,
        "Send the phone, ID, or customer name you want to search.",
        keyboard,
      );
      return;
    }

    if (/^stats$/i.test(text)) {
      if (!(await requireAdmin(msg))) {
        return;
      }

      const stats = await countSalesRecords();
      await bot.sendMessage(
        chatId,
        [
          `Sales records: ${stats.total_records}`,
          `Customers: ${stats.total_customers}`,
          `Total amount: ${formatMoney(stats.total_amount)}`,
        ].join("\n"),
        keyboard,
      );
      return;
    }

    await searchAndReply(chatId, text);
  } catch (error) {
    console.error(error);
    await bot.sendMessage(
      chatId,
      "Search failed. Check the server logs for details.",
      keyboard,
    );
  }
});

process.once("SIGINT", async () => {
  await bot.stopPolling();
  await pool.end();
  process.exit(0);
});

process.once("SIGTERM", async () => {
  await bot.stopPolling();
  await pool.end();
  process.exit(0);
});

testConnection()
  .then(() => console.log("Bot is running. Database connection OK."))
  .catch((error) => {
    console.error("Database connection failed.");
    console.error("Code:", error.code || "unknown");
    console.error("Message:", error.message || error.toString());
    if (error.detail) console.error("Detail:", error.detail);
    if (error.hint) console.error("Hint:", error.hint);
    process.exit(1);
  });
