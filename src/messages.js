function formatMoney(value) {
  return Number(value || 0).toLocaleString("en-US", {
    maximumFractionDigits: 2,
  });
}

function formatCustomerSummary(summary) {
  const purchases = Array.isArray(summary.purchases) ? summary.purchases : [];
  const recentPurchases = purchases.slice(0, 5).map((purchase) => {
    const parts = [
      purchase.purchase_date || "No date",
      purchase.purchase_name || "Purchase",
      purchase.quantity ? `qty ${purchase.quantity}` : null,
      purchase.amount ? `amount ${formatMoney(purchase.amount)}` : null,
    ].filter(Boolean);

    return `- ${parts.join(" | ")}`;
  });

  const lines = [
    "Customer summary:",
    summary.customer_name ? `Name: ${summary.customer_name}` : null,
    summary.phone ? `Phone: ${summary.phone}` : null,
    summary.external_id ? `ID: ${summary.external_id}` : null,
    summary.address ? `Address: ${summary.address}` : null,
    "",
    `Rows found: ${summary.rows_found}`,
    `Transactions: ${summary.total_transactions}`,
    `Total quantity: ${formatMoney(summary.total_quantity)}`,
    `Total amount: ${formatMoney(summary.total_amount)}`,
    summary.first_purchase_date && summary.last_purchase_date
      ? `Purchase dates: ${summary.first_purchase_date} to ${summary.last_purchase_date}`
      : null,
    recentPurchases.length ? "" : null,
    recentPurchases.length ? "Recent purchases:" : null,
    ...recentPurchases,
  ].filter(Boolean);

  return lines.join("\n");
}

function helpText() {
  return [
    "Choose a shortcut or use a command:",
    "",
    "/myid - show your Telegram user ID",
    "/import - upload an Excel file",
    "/search phone_id_or_name - customer sales summary",
    "/stats - count sales records and customers",
    "/help - show this menu",
    "",
    "You can also send a phone, ID, or customer name directly.",
  ].join("\n");
}

function importHelpText() {
  return [
    "Upload an .xlsx, .xls, or .csv file here.",
    "",
    "Supported columns include:",
    "customer_name, phone, address",
    "purchase, purchase_date",
    "number_of_transactions, quantity, amount",
    "id or customer_id are optional",
  ].join("\n");
}

module.exports = {
  formatCustomerSummary,
  formatMoney,
  helpText,
  importHelpText,
};
