require("dotenv").config();

const TelegramBot = require("node-telegram-bot-api");
const { commands } = require("../src/config");
const { registerHandlers } = require("../src/registerHandlers");
const { testConnection } = require("../src/db");

if (!process.env.BOT_TOKEN) {
  throw new Error("BOT_TOKEN is missing.");
}

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is missing.");
}

let bot;
let commandsReady = false;
let databaseReady;

function getBot() {
  if (!bot) {
    bot = new TelegramBot(process.env.BOT_TOKEN, { polling: false });
    registerHandlers(bot);
  }
  return bot;
}

async function ensureDatabaseReady() {
  if (!databaseReady) {
    databaseReady = testConnection().catch((error) => {
      databaseReady = null;
      throw error;
    });
  }
  await databaseReady;
}

function validWebhookSecret(secret) {
  return /^[A-Za-z0-9_-]{1,256}$/.test(String(secret || ""));
}

module.exports = async function handler(req, res) {
  if (req.method === "GET") {
    return res.status(200).json({ ok: true, service: "telegram-webhook" });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!validWebhookSecret(expectedSecret)) {
    console.error("TELEGRAM_WEBHOOK_SECRET is missing or invalid");
    return res.status(500).json({ ok: false, error: "webhook_not_configured" });
  }

  if (req.headers["x-telegram-bot-api-secret-token"] !== expectedSecret) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }

  try {
    if (!commandsReady) {
      await getBot().setMyCommands(commands);
      commandsReady = true;
    }

    await ensureDatabaseReady();
    await getBot().processUpdate(req.body);
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error("Telegram webhook failed:", error);
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
};
