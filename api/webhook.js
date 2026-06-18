const TelegramBot = require("node-telegram-bot-api");
const { commands } = require("../src/config");
const { registerHandlers } = require("../src/registerHandlers");

if (!process.env.BOT_TOKEN) {
  throw new Error("BOT_TOKEN is missing.");
}

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is missing.");
}

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: false });
registerHandlers(bot);

let commandsReady = false;

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(200).send("Telegram sales bot webhook is running.");
    return;
  }

  try {
    if (!commandsReady) {
      await bot.setMyCommands(commands);
      commandsReady = true;
    }

    await bot.processUpdate(req.body);
    res.status(200).send("ok");
  } catch (error) {
    console.error(error);
    res.status(500).send("error");
  }
};
