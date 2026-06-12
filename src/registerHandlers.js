const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const {
  countSalesRecords,
  findCustomerSummary,
  insertSalesRecord,
} = require("./db");
const { parseSalesRecordsFromExcel } = require("./excel");
const { adminIds, keyboard } = require("./config");
const {
  formatCustomerSummary,
  formatMoney,
  helpText,
  importHelpText,
} = require("./messages");

function isAdmin(msg) {
  if (adminIds.size === 0) {
    return false;
  }

  return adminIds.has(String(msg.from?.id));
}

async function requireAdmin(bot, msg) {
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

async function sendStats(bot, chatId) {
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
}

async function searchAndReply(bot, chatId, query) {
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

function registerHandlers(bot, options = {}) {
  const downloadsDir = options.downloadsDir || path.join(os.tmpdir(), "telegram-sales-bot");

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
    if (!(await requireAdmin(bot, msg))) {
      return;
    }

    await bot.sendMessage(msg.chat.id, importHelpText(), keyboard);
  });

  bot.onText(/^\/search(?:\s+(.+))?$/, async (msg, match) => {
    const chatId = msg.chat.id;
    const query = match?.[1]?.trim();

    if (!query) {
      await bot.sendMessage(
        chatId,
        "Send /search followed by a phone, ID, or name.",
        keyboard,
      );
      return;
    }

    try {
      await searchAndReply(bot, chatId, query);
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
    if (!(await requireAdmin(bot, msg))) {
      return;
    }

    try {
      await sendStats(bot, msg.chat.id);
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
    if (!(await requireAdmin(bot, msg))) {
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
        keyboard,
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
          keyboard,
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
        keyboard,
      );
    } catch (error) {
      console.error(error);
      await bot.sendMessage(
        chatId,
        "Import failed. Check the server logs for details.",
        keyboard,
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
        if (!(await requireAdmin(bot, msg))) {
          return;
        }

        await bot.sendMessage(chatId, importHelpText(), keyboard);
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
        if (!(await requireAdmin(bot, msg))) {
          return;
        }

        await sendStats(bot, chatId);
        return;
      }

      await searchAndReply(bot, chatId, text);
    } catch (error) {
      console.error(error);
      await bot.sendMessage(
        chatId,
        "Search failed. Check the server logs for details.",
        keyboard,
      );
    }
  });
}

module.exports = {
  registerHandlers,
};
