const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const {
  countCustomerProfiles,
  findCustomerProfile,
  getBotAccessUser,
  listBotAccessUsers,
  removeBotAccessUser,
  upsertBotAccessUser,
  upsertCustomerProfiles,
} = require("./db");
const { normalizePhone, parseCustomerProfilesFromExcel } = require("./excel");
const { syncGoogleSheet } = require("./googleSheets");
const { adminIds } = require("./config");
const {
  formatCustomerProfile,
  helpText,
  importHelpText,
  statsText,
} = require("./messages");

const managementStates = new Map();

function isMainAdminId(telegramId) {
  return adminIds.has(String(telegramId));
}

async function getRole(msg) {
  const telegramId = String(msg.from?.id || "");

  if (isMainAdminId(telegramId)) {
    return "main_admin";
  }

  const accessUser = await getBotAccessUser(telegramId);
  return accessUser?.role || "none";
}

function canSearch(role) {
  return role === "main_admin" || role === "admin" || role === "user";
}

function canImport(role) {
  return role === "main_admin" || role === "admin";
}

function canManage(role) {
  return role === "main_admin";
}

function keyboardForRole(role) {
  const rows = [];

  if (canSearch(role)) {
    rows.push([{ text: "بحث" }]);
  }

  if (canImport(role)) {
    rows.push([{ text: "رفع Excel" }, { text: "إحصائيات" }]);
  }

  rows.push([{ text: "مساعدة" }, { text: "رقمي" }]);

  if (canManage(role)) {
    rows.push([{ text: "إدارة المستخدمين" }]);
  }

  return {
    reply_markup: {
      keyboard: rows,
      resize_keyboard: true,
      is_persistent: true,
      one_time_keyboard: false,
      input_field_placeholder: "اكتب رقم الهاتف أو اسم العميل",
    },
  };
}

function managementKeyboard() {
  return {
    reply_markup: {
      keyboard: [
        [{ text: "إضافة مستخدم" }, { text: "حذف مستخدم" }],
        [{ text: "إضافة أدمن" }, { text: "حذف أدمن" }],
        [{ text: "قائمة الصلاحيات" }, { text: "رجوع" }],
      ],
      resize_keyboard: true,
      is_persistent: true,
      one_time_keyboard: false,
      input_field_placeholder: "اختر إجراء إدارة المستخدمين",
    },
  };
}

function isTelegramId(value) {
  return /^\d{4,20}$/.test(String(value || "").trim());
}

async function requireSearchAccess(bot, msg, role) {
  if (canSearch(role)) {
    return true;
  }

  await bot.sendMessage(
    msg.chat.id,
    [
      "غير مسموح لك باستخدام البحث في هذا البوت.",
      `رقم حسابك في تيليجرام: ${msg.from?.id}`,
      "اطلب من الأدمن إضافتك من زر إدارة المستخدمين.",
    ].join("\n"),
    keyboardForRole(role),
  );
  return false;
}

async function requireImportAccess(bot, msg, role) {
  if (canImport(role)) {
    return true;
  }

  await bot.sendMessage(
    msg.chat.id,
    [
      "رفع ملف Excel متاح للأدمن فقط.",
      `رقم حسابك في تيليجرام: ${msg.from?.id}`,
    ].join("\n"),
    keyboardForRole(role),
  );
  return false;
}

async function requireManagementAccess(bot, msg, role) {
  if (canManage(role)) {
    return true;
  }

  await bot.sendMessage(
    msg.chat.id,
    "إدارة المستخدمين متاحة للـ main admins الموجودين في ADMIN_IDS فقط.",
    keyboardForRole(role),
  );
  return false;
}

async function editStatus(bot, message, text, role) {
  if (!message) return;

  try {
    await bot.editMessageText(text, {
      chat_id: message.chat.id,
      message_id: message.message_id,
      reply_markup: keyboardForRole(role).reply_markup,
    });
  } catch (error) {
    console.error("Could not edit status message:", error.message);

    if (
      message.chat?.id &&
      String(error.message).toLowerCase().includes("message can't be edited")
    ) {
      try {
        await bot.sendMessage(message.chat.id, text, keyboardForRole(role));
      } catch (sendError) {
        console.error("Failed to send fallback status message:", sendError.message);
      }
    }
  }
}

async function sendStats(bot, chatId, role) {
  const stats = await countCustomerProfiles();
  await bot.sendMessage(chatId, statsText(stats), keyboardForRole(role));
}

async function searchAndReply(bot, chatId, query, role) {
  const normalizedQuery = normalizePhone(query) || query;
  const profile = await findCustomerProfile(normalizedQuery);

  if (!profile) {
    await bot.sendMessage(
      chatId,
      "لا توجد بيانات لهذا الرقم أو الاسم.",
      keyboardForRole(role),
    );
    return;
  }

  await bot.sendMessage(chatId, formatCustomerProfile(profile), keyboardForRole(role));
}

async function showAccessManagement(bot, msg) {
  await bot.sendMessage(
    msg.chat.id,
    [
      "إدارة المستخدمين:",
      "",
      "إضافة مستخدم: يسمح له بالبحث فقط.",
      "إضافة أدمن: يسمح له بالبحث ورفع Excel.",
      "حذف مستخدم/أدمن: إزالة الصلاحية من قاعدة البيانات.",
      "",
      "الـ main admins الموجودون في ADMIN_IDS لا يمكن حذفهم من هنا.",
    ].join("\n"),
    managementKeyboard(),
  );
}

async function sendAccessList(bot, msg) {
  const users = await listBotAccessUsers();
  const mainAdmins = [...adminIds].map((id) => `main_admin: ${id}`);
  const dbUsers = users.map((user) => `${user.role}: ${user.telegram_id}`);
  const lines = [...mainAdmins, ...dbUsers];

  await bot.sendMessage(
    msg.chat.id,
    lines.length ? lines.join("\n") : "لا توجد صلاحيات محفوظة في قاعدة البيانات.",
    managementKeyboard(),
  );
}

async function handleManagementState(bot, msg, text) {
  const state = managementStates.get(String(msg.from.id));
  if (!state) return false;

  if (/^(رجوع|إلغاء|الغاء)$/i.test(text)) {
    managementStates.delete(String(msg.from.id));
    const role = await getRole(msg);
    await bot.sendMessage(msg.chat.id, "تم الإلغاء.", keyboardForRole(role));
    return true;
  }

  if (!isTelegramId(text)) {
    await bot.sendMessage(
      msg.chat.id,
      "أرسل Telegram ID صحيحا كأرقام فقط، أو اكتب رجوع للإلغاء.",
      managementKeyboard(),
    );
    return true;
  }

  const targetId = text.trim();
  let message;

  if (state.action === "add_user") {
    await upsertBotAccessUser(targetId, "user", msg.from.id);
    message = `تمت إضافة المستخدم ${targetId} للبحث فقط.`;
  }

  if (state.action === "add_admin") {
    await upsertBotAccessUser(targetId, "admin", msg.from.id);
    message = `تمت إضافة الأدمن ${targetId}. يستطيع البحث ورفع Excel.`;
  }

  if (state.action === "remove_user") {
    const removed = await removeBotAccessUser(targetId, "user");
    message = removed
      ? `تم حذف المستخدم ${targetId}.`
      : `لم يتم العثور على المستخدم ${targetId} بصلاحية user.`;
  }

  if (state.action === "remove_admin") {
    if (isMainAdminId(targetId)) {
      message = "لا يمكن حذف main admin من هنا لأنه موجود في ADMIN_IDS.";
    } else {
      const removed = await removeBotAccessUser(targetId, "admin");
      message = removed
        ? `تم حذف الأدمن ${targetId}.`
        : `لم يتم العثور على الأدمن ${targetId} بصلاحية admin.`;
    }
  }

  managementStates.delete(String(msg.from.id));
  await bot.sendMessage(msg.chat.id, message, managementKeyboard());
  return true;
}

function registerHandlers(bot, options = {}) {
  const downloadsDir =
    options.downloadsDir || path.join(os.tmpdir(), "telegram-sales-bot");

  bot.onText(/^\/start$/, async (msg) => {
    const role = await getRole(msg);
    await bot.sendMessage(msg.chat.id, helpText(), keyboardForRole(role));
  });

  bot.onText(/^\/help$/, async (msg) => {
    const role = await getRole(msg);
    await bot.sendMessage(msg.chat.id, helpText(), keyboardForRole(role));
  });

  bot.onText(/^\/myid$/, async (msg) => {
    const role = await getRole(msg);
    await bot.sendMessage(
      msg.chat.id,
      `رقم حسابك في تيليجرام: ${msg.from.id}`,
      keyboardForRole(role),
    );
  });

  bot.onText(/^\/import$/, async (msg) => {
    const role = await getRole(msg);
    if (!(await requireImportAccess(bot, msg, role))) return;
    await bot.sendMessage(msg.chat.id, importHelpText(), keyboardForRole(role));
  });

  bot.onText(/^\/search(?:\s+(.+))?$/, async (msg, match) => {
    const role = await getRole(msg);
    const chatId = msg.chat.id;
    const query = match?.[1]?.trim();

    if (!(await requireSearchAccess(bot, msg, role))) return;

    if (!query) {
      await bot.sendMessage(
        chatId,
        "اكتب /search ثم رقم الهاتف أو اسم العميل.",
        keyboardForRole(role),
      );
      return;
    }

    try {
      await searchAndReply(bot, chatId, query, role);
    } catch (error) {
      console.error(error);
      await bot.sendMessage(
        chatId,
        "فشل البحث. راجع سجلات السيرفر للتفاصيل.",
        keyboardForRole(role),
      );
    }
  });

  bot.onText(/^\/stats$/, async (msg) => {
    const role = await getRole(msg);
    if (!(await requireImportAccess(bot, msg, role))) return;

    try {
      await sendStats(bot, msg.chat.id, role);
    } catch (error) {
      console.error(error);
      await bot.sendMessage(
        msg.chat.id,
        "تعذر تحميل الإحصائيات. راجع سجلات السيرفر.",
        keyboardForRole(role),
      );
    }
  });

  bot.onText(/^\/sync$/, async (msg) => {
    const role = await getRole(msg);
    if (!(await requireImportAccess(bot, msg, role))) return;

    try {
      const chatId = msg.chat.id;
      const statusMessage = await bot.sendMessage(
        chatId,
        "جاري مزامنة البيانات من Google Sheet...",
        keyboardForRole(role),
      );

      const result = await syncGoogleSheet(upsertCustomerProfiles);

      await editStatus(
        bot,
        statusMessage,
        result.message,
        role,
      );
    } catch (error) {
      console.error(error);
      await bot.sendMessage(
        msg.chat.id,
        "فشلت المزامنة. راجع سجلات السيرفر.",
        keyboardForRole(role),
      );
    }
  });

  bot.on("document", async (msg) => {
    const role = await getRole(msg);
    if (!(await requireImportAccess(bot, msg, role))) return;

    const chatId = msg.chat.id;
    const document = msg.document;
    const fileName = document.file_name || "";
    const ext = path.extname(fileName).toLowerCase();

    if (![".xlsx", ".xls", ".csv"].includes(ext)) {
      await bot.sendMessage(
        chatId,
        "من فضلك ارفع ملف Excel بصيغة .xlsx أو .xls أو .csv",
        keyboardForRole(role),
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
        keyboardForRole(role),
      );

      downloadedPath = await bot.downloadFile(document.file_id, downloadsDir);
      await editStatus(bot, statusMessage, "تم تحميل الملف. جاري تحليل ملف Excel...", role);

      const profiles = parseCustomerProfilesFromExcel(downloadedPath);

      if (profiles.length === 0) {
        await editStatus(
          bot,
          statusMessage,
          "لم يتم العثور على صفوف صالحة. تأكد من وجود أعمدة الهاتف واسم العميل والعنوان.",
          role,
        );
        return;
      }

      await editStatus(
        bot,
        statusMessage,
        `تم العثور على ${profiles.length} عميل. جاري الحفظ في قاعدة البيانات...`,
        role,
      );

      await upsertCustomerProfiles(profiles);

      await editStatus(
        bot,
        statusMessage,
        `تم حفظ ${profiles.length} عميل بنجاح.`,
        role,
      );
    } catch (error) {
      const errorMessage = String(error?.message || error || "Unknown error");
      console.error("Import error:", errorMessage);
      console.error(error.stack || error);

      if (statusMessage) {
        await editStatus(bot, statusMessage, `فشل الاستيراد: ${errorMessage}`, role);
        return;
      }

      await bot.sendMessage(chatId, `فشل الاستيراد: ${errorMessage}`, keyboardForRole(role));
    } finally {
      if (downloadedPath) {
        await fs.rm(downloadedPath, { force: true });
      }
    }
  });

  bot.on("message", async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text?.trim();

    if (!text || text.startsWith("/") || msg.document) return;

    try {
      const role = await getRole(msg);

      if (await handleManagementState(bot, msg, text)) return;

      const arabicSearch = text.match(/^بحث\s+(.+)$/i);
      if (arabicSearch) {
        if (!(await requireSearchAccess(bot, msg, role))) return;
        await searchAndReply(bot, chatId, arabicSearch[1].trim(), role);
        return;
      }

      if (/^(help|مساعدة)$/i.test(text)) {
        await bot.sendMessage(chatId, helpText(), keyboardForRole(role));
        return;
      }

      if (/^(myid|رقمي)$/i.test(text)) {
        await bot.sendMessage(
          chatId,
          `رقم حسابك في تيليجرام: ${msg.from.id}`,
          keyboardForRole(role),
        );
        return;
      }

      if (/^(إدارة المستخدمين|ادارة المستخدمين)$/i.test(text)) {
        if (!(await requireManagementAccess(bot, msg, role))) return;
        await showAccessManagement(bot, msg);
        return;
      }

      if (/^إضافة مستخدم$/i.test(text)) {
        if (!(await requireManagementAccess(bot, msg, role))) return;
        managementStates.set(String(msg.from.id), { action: "add_user" });
        await bot.sendMessage(msg.chat.id, "أرسل Telegram ID للمستخدم.", managementKeyboard());
        return;
      }

      if (/^إضافة أدمن$/i.test(text)) {
        if (!(await requireManagementAccess(bot, msg, role))) return;
        managementStates.set(String(msg.from.id), { action: "add_admin" });
        await bot.sendMessage(msg.chat.id, "أرسل Telegram ID للأدمن الجديد.", managementKeyboard());
        return;
      }

      if (/^حذف مستخدم$/i.test(text)) {
        if (!(await requireManagementAccess(bot, msg, role))) return;
        managementStates.set(String(msg.from.id), { action: "remove_user" });
        await bot.sendMessage(msg.chat.id, "أرسل Telegram ID للمستخدم المراد حذفه.", managementKeyboard());
        return;
      }

      if (/^حذف أدمن$/i.test(text)) {
        if (!(await requireManagementAccess(bot, msg, role))) return;
        managementStates.set(String(msg.from.id), { action: "remove_admin" });
        await bot.sendMessage(msg.chat.id, "أرسل Telegram ID للأدمن المراد حذفه.", managementKeyboard());
        return;
      }

      if (/^قائمة الصلاحيات$/i.test(text)) {
        if (!(await requireManagementAccess(bot, msg, role))) return;
        await sendAccessList(bot, msg);
        return;
      }

      if (/^رجوع$/i.test(text)) {
        await bot.sendMessage(chatId, "تم الرجوع للقائمة الرئيسية.", keyboardForRole(role));
        return;
      }

      if (/^(import excel|رفع excel|رفع|رفع ملف)$/i.test(text)) {
        if (!(await requireImportAccess(bot, msg, role))) return;
        await bot.sendMessage(chatId, importHelpText(), keyboardForRole(role));
        return;
      }

      if (/^(search|بحث)$/i.test(text)) {
        if (!(await requireSearchAccess(bot, msg, role))) return;
        await bot.sendMessage(
          chatId,
          "اكتب رقم الهاتف أو اسم العميل الذي تريد البحث عنه.",
          keyboardForRole(role),
        );
        return;
      }

      if (/^(stats|إحصائيات)$/i.test(text)) {
        if (!(await requireImportAccess(bot, msg, role))) return;
        await sendStats(bot, chatId, role);
        return;
      }

      if (/^(sync|مزامنة)$/i.test(text)) {
        if (!(await requireImportAccess(bot, msg, role))) return;
        const statusMessage = await bot.sendMessage(
          chatId,
          "جاري مزامنة البيانات من Google Sheet...",
          keyboardForRole(role),
        );

        try {
          const result = await syncGoogleSheet(upsertCustomerProfiles);
          await editStatus(bot, statusMessage, result.message, role);
        } catch (error) {
          console.error(error);
          await editStatus(
            bot,
            statusMessage,
            "فشلت المزامنة. راجع سجلات السيرفر.",
            role,
          );
        }
        return;
      }

      if (!(await requireSearchAccess(bot, msg, role))) return;
      await searchAndReply(bot, chatId, text, role);
    } catch (error) {
      console.error(error);
      const role = await getRole(msg).catch(() => "none");
      await bot.sendMessage(
        chatId,
        "فشل تنفيذ الطلب. راجع سجلات السيرفر للتفاصيل.",
        keyboardForRole(role),
      );
    }
  });
}

module.exports = {
  registerHandlers,
};
