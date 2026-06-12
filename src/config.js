const adminIds = new Set(
  (process.env.ADMIN_IDS || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean),
);

const allowedUserIds = new Set(
  (process.env.ALLOWED_USER_IDS || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean),
);

const keyboard = {
  reply_markup: {
    keyboard: [
      [{ text: "بحث" }, { text: "رفع Excel" }],
      [{ text: "إحصائيات" }, { text: "مساعدة" }],
      [{ text: "رقمي" }],
    ],
    resize_keyboard: true,
    is_persistent: true,
    one_time_keyboard: false,
    input_field_placeholder: "اكتب رقم الهاتف أو اسم العميل",
  },
};

const commands = [
  { command: "start", description: "فتح القائمة" },
  { command: "help", description: "عرض المساعدة" },
  { command: "myid", description: "إظهار رقم حسابك" },
  { command: "import", description: "رفع ملف Excel" },
  { command: "search", description: "بحث برقم الهاتف أو الاسم" },
  { command: "stats", description: "إحصائيات البيانات" },
];

module.exports = {
  adminIds,
  allowedUserIds,
  commands,
  keyboard,
};
