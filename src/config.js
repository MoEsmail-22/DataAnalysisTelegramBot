const adminIds = new Set(
  (process.env.ADMIN_IDS || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean),
);

const commands = [
  { command: "start", description: "فتح القائمة" },
  { command: "help", description: "عرض المساعدة" },
  { command: "myid", description: "إظهار رقم حسابك" },
  { command: "search", description: "بحث برقم الهاتف أو الاسم" },
  { command: "stats", description: "إحصائيات البيانات" },
  { command: "sync", description: "تحديث البيانات من Google Sheet يدويا" },
  { command: "export", description: "تصدير آخر البيانات كملف Excel" },
];

module.exports = {
  adminIds,
  commands,
};
