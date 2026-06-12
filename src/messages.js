function formatList(title, values) {
  if (!Array.isArray(values) || values.length === 0) return null;
  return [title, ...values.map((value, index) => `${index + 1}. ${value}`)].join("\n");
}

function formatCustomerProfile(profile) {
  const lines = [
    "بيانات العميل:",
    profile.customer_name ? `الاسم: ${profile.customer_name}` : null,
    profile.governorate ? `المحافظة: ${profile.governorate}` : null,
    profile.zone ? `الزون: ${profile.zone}` : null,
    profile.area ? `المنطقة: ${profile.area}` : null,
    "",
    formatList("أرقام الهاتف:", profile.phones),
    "",
    formatList("العناوين:", profile.addresses),
    profile.notes ? "" : null,
    profile.notes ? `ملاحظات: ${profile.notes}` : null,
  ].filter(Boolean);

  return lines.join("\n");
}

function helpText() {
  return [
    "اختار من القائمة أو استخدم أمر:",
    "",
    "/myid - إظهار رقم حسابك في تيليجرام",
    "/import - رفع ملف Excel",
    "/search phone_or_name - البحث برقم الهاتف أو الاسم",
    "/stats - إحصائيات البيانات",
    "/help - عرض المساعدة",
    "",
    "يمكنك أيضا إرسال رقم الهاتف أو اسم العميل مباشرة.",
  ].join("\n");
}

function importHelpText() {
  return [
    "ارفع ملف Excel هنا بصيغة .xlsx أو .xls أو .csv.",
    "",
    "الأعمدة المدعومة في الملف الرئيسي:",
    "الهاتف 001، اسم العميل، الهاتف 0012، الهاتف 002، الهاتف 003",
    "المحافظة، Zone، Area",
    "العنوان، العنوان 02، العنوان 03، ملحوظة",
  ].join("\n");
}

function statsText(stats) {
  return [
    `عدد العملاء: ${stats.total_customers}`,
    `عدد أرقام الهاتف: ${stats.total_phone_numbers}`,
    `عدد العناوين: ${stats.total_addresses}`,
  ].join("\n");
}

module.exports = {
  formatCustomerProfile,
  helpText,
  importHelpText,
  statsText,
};
