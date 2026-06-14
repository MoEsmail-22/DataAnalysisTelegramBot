require("dotenv").config();

const path = require("path");
const TelegramBot = require("node-telegram-bot-api");
const { commands } = require("./config");
const {
  deleteCustomerProfilesNotInHashes,
  pool,
  testConnection,
  upsertCustomerProfiles,
} = require("./db");
const { registerHandlers } = require("./registerHandlers");
const { startPeriodicSync } = require("./googleSheets");

const { BOT_TOKEN, SERVER_PUBLIC_URL } = process.env;

if (!BOT_TOKEN) {
  console.error(
    "EFATAL: BOT_TOKEN is missing. Create .env and set BOT_TOKEN=...",
  );
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  console.error(
    "EFATAL: DATABASE_URL is missing. Provide a proper PostgreSQL string.",
  );
  process.exit(1);
}

// OPTIMIZATION: Smart dynamic connection switcher. If SERVER_PUBLIC_URL is provided,
// it turns on webhooks, dramatically saving server idle CPU and memory footprints.
let bot;
if (SERVER_PUBLIC_URL) {
  const port = process.env.PORT || 3000;
  bot = new TelegramBot(BOT_TOKEN, {
    web_hook: {
      port: port,
    },
  });
  bot.setWebHook(`${SERVER_PUBLIC_URL}/bot${BOT_TOKEN}`);
  console.log(
    `Bot initialized via high-performance Webhooks listening on port ${port}`,
  );
} else {
  bot = new TelegramBot(BOT_TOKEN, { polling: true });
  console.log("Bot initialized via standard Long-Polling mode.");
}

registerHandlers(bot, {
  downloadsDir: path.join(__dirname, "..", "downloads"),
});

bot.setMyCommands(commands).catch((error) => {
  console.error("Failed to set Telegram commands:", error.message);
});

async function gracefulShutdown() {
  if (!SERVER_PUBLIC_URL) {
    await bot.stopPolling();
  }
  await pool.end();
  process.exit(0);
}

process.once("SIGINT", gracefulShutdown);
process.once("SIGTERM", gracefulShutdown);

testConnection()
  .then(() => {
    console.log("Bot is running. Database connection OK.");

    const syncInterval = parseInt(
      process.env.SYNC_INTERVAL_MINUTES || "10",
      10,
    );
    startPeriodicSync(
      upsertCustomerProfiles,
      deleteCustomerProfilesNotInHashes,
      syncInterval,
    );
  })
  .catch((error) => {
    console.error("Database connection failed.");
    console.error("Code:", error.message);
    process.exit(1);
  });
