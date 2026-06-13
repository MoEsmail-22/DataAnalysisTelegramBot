function formatList(title, values) {
  if (!Array.isArray(values) || values.length === 0) return null;
  return [
    title,
    ...values.map((value, index) => `${index + 1}. ${value}`),
  ].join("\n");
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
    "اختار من القائمة أو اكتب أمر بالعربي:",
    "",
    "رقمي - إظهار رقم حسابك في تيليجرام",
    "مزامنة - مزامنة البيانات من Google Sheet",
    "بحث 010xxxxxxxx - البحث برقم الهاتف",
    "بحث اسم العميل - البحث باسم العميل",
    "إحصائيات - إحصائيات البيانات",
    "مساعدة - عرض المساعدة",
    "",
    "يمكنك أيضا إرسال رقم الهاتف أو اسم العميل مباشرة بدون كتابة كلمة بحث.",
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
  statsText,
};
