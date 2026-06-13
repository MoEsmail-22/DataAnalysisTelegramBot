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
      [{ text: "بحث" }, { text: "مزامنة" }],
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
  { command: "search", description: "بحث برقم الهاتف أو الاسم" },
  { command: "stats", description: "إحصائيات البيانات" },
  { command: "sync", description: "مزامنة من Google Sheet يدويا" },
];

module.exports = {
  adminIds,
  allowedUserIds,
  commands,
  keyboard,
};
