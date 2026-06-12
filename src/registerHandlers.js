const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const {
  countCustomerProfiles,
  findCustomerProfile,
  upsertCustomerProfile,
} = require("./db");
const { normalizePhone, parseCustomerProfilesFromExcel } = require("./excel");
const { adminIds, allowedUserIds, keyboard } = require("./config");
const {
  formatCustomerProfile,
  helpText,
  importHelpText,
  statsText,
} = require("./messages");

function isAdmin(msg) {
  if (adminIds.size === 0) {
    return false;
  }

  return adminIds.has(String(msg.from?.id));
}

function isAllowedUser(msg) {
  if (isAdmin(msg)) {
    return true;
  }

  if (allowedUserIds.size === 0) {
    return false;
  }

  return allowedUserIds.has(String(msg.from?.id));
}

async function requireAdmin(bot, msg) {
  if (isAdmin(msg)) {
    return true;
  }

  await bot.sendMessage(
    msg.chat.id,
    [
      "هذا الأمر متاح للأدمن فقط.",
      `رقم حسابك في تيليجرام: ${msg.from?.id}`,
      "اطلب من صاحب البوت إضافته في ADMIN_IDS.",
    ].join("\n"),
    keyboard,
  );
  return false;
}

async function requireAllowedUser(bot, msg) {
  if (isAllowedUser(msg)) {
    return true;
  }

  await bot.sendMessage(
    msg.chat.id,
    [
      "غير مسموح لك باستخدام البحث في هذا البوت.",
      `رقم حسابك في تيليجرام: ${msg.from?.id}`,
      "اطلب من الأدمن إضافتك في ALLOWED_USER_IDS.",
    ].join("\n"),
    keyboard,
  );
  return false;
}

async function editStatus(bot, message, text) {
  if (!message) {
    return;
  }

  try {
    await bot.editMessageText(text, {
      chat_id: message.chat.id,
      message_id: message.message_id,
      reply_markup: keyboard.reply_markup,
    });
  } catch (error) {
    console.error("Could not edit status message:", error.message);
  }
}

async function sendStats(bot, chatId) {
  const stats = await countCustomerProfiles();
  await bot.sendMessage(chatId, statsText(stats), keyboard);
}

async function searchAndReply(bot, chatId, query) {
  const normalizedQuery = normalizePhone(query) || query;
  const profile = await findCustomerProfile(normalizedQuery);

  if (!profile) {
    await bot.sendMessage(
      chatId,
      "لا توجد بيانات لهذا الرقم أو الاسم.",
      keyboard,
    );
    return;
  }

  await bot.sendMessage(chatId, formatCustomerProfile(profile), keyboard);
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

    if (!(await requireAllowedUser(bot, msg))) {
      return;
    }

    if (!query) {
      await bot.sendMessage(
        chatId,
        "اكتب /search ثم رقم الهاتف أو اسم العميل.",
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
        "تعذر تحميل الإحصائيات. راجع سجلات السيرفر.",
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
        "من فضلك ارفع ملف Excel بصيغة .xlsx أو .xls أو .csv",
        keyboard,
      );
      return;
    }

    await fs.mkdir(downloadsDir, { recursive: true });

    let downloadedPath;
    let statusMessage;
    try {
      statusMessage = await bot.sendMessage(
        chatId,
        "جاري تحميل الملف وقراءة البيانات...",
        keyboard,
      );

      downloadedPath = await bot.downloadFile(document.file_id, downloadsDir);
      await editStatus(bot, statusMessage, "تم تحميل الملف. جاري تحليل ملف Excel...");

      const profiles = parseCustomerProfilesFromExcel(downloadedPath);

      if (profiles.length === 0) {
        await editStatus(
          bot,
          statusMessage,
          "لم يتم العثور على صفوف صالحة. تأكد من وجود أعمدة الهاتف واسم العميل والعنوان.",
        );
        return;
      }

      await editStatus(
        bot,
        statusMessage,
        `تم العثور على ${profiles.length} عميل. جاري الحفظ في قاعدة البيانات...`,
      );

      let inserted = 0;
      let updated = 0;
      for (const profile of profiles) {
        const result = await upsertCustomerProfile(profile);
        if (result === "inserted") inserted += 1;
        if (result === "updated") updated += 1;
      }

      await editStatus(
        bot,
        statusMessage,
        `تم استيراد ${inserted} عميل جديد وتحديث ${updated} عميل.`,
      );
    } catch (error) {
      console.error(error);
      if (statusMessage) {
        await editStatus(
          bot,
          statusMessage,
          "فشل الاستيراد. راجع سجلات السيرفر للتفاصيل.",
        );
        return;
      }

      await bot.sendMessage(
        chatId,
        "فشل الاستيراد. راجع سجلات السيرفر للتفاصيل.",
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
      const arabicSearch = text.match(/^بحث\s+(.+)$/i);
      if (arabicSearch) {
        if (!(await requireAllowedUser(bot, msg))) {
          return;
        }

        await searchAndReply(bot, chatId, arabicSearch[1].trim());
        return;
      }

      if (/^(help|مساعدة)$/i.test(text)) {
        await bot.sendMessage(chatId, helpText(), keyboard);
        return;
      }

      if (/^(myid|رقمي)$/i.test(text)) {
        await bot.sendMessage(
          chatId,
          `رقم حسابك في تيليجرام: ${msg.from.id}`,
          keyboard,
        );
        return;
      }

      if (/^(import excel|رفع excel|رفع|رفع ملف)$/i.test(text)) {
        if (!(await requireAdmin(bot, msg))) {
          return;
        }

        await bot.sendMessage(chatId, importHelpText(), keyboard);
        return;
      }

      if (/^(search|بحث)$/i.test(text)) {
        if (!(await requireAllowedUser(bot, msg))) {
          return;
        }

        await bot.sendMessage(
          chatId,
          "اكتب رقم الهاتف أو اسم العميل الذي تريد البحث عنه.",
          keyboard,
        );
        return;
      }

      if (/^(stats|إحصائيات)$/i.test(text)) {
        if (!(await requireAdmin(bot, msg))) {
          return;
        }

        await sendStats(bot, chatId);
        return;
      }

      if (!(await requireAllowedUser(bot, msg))) {
        return;
      }

      await searchAndReply(bot, chatId, text);
    } catch (error) {
      console.error(error);
      await bot.sendMessage(
        chatId,
        "فشل البحث. راجع سجلات السيرفر للتفاصيل.",
        keyboard,
      );
    }
  });
}

module.exports = {
  registerHandlers,
};
