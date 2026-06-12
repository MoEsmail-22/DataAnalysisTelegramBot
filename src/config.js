const adminIds = new Set(
  (process.env.ADMIN_IDS || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean),
);

const keyboard = {
  reply_markup: {
    keyboard: [
      [{ text: "Search" }, { text: "Import Excel" }],
      [{ text: "Stats" }, { text: "Help" }],
    ],
    resize_keyboard: true,
    is_persistent: true,
    one_time_keyboard: false,
    input_field_placeholder: "Choose a shortcut or type phone/ID",
  },
};

const commands = [
  { command: "start", description: "Open the bot menu" },
  { command: "help", description: "Show commands and shortcuts" },
  { command: "myid", description: "Show your Telegram user ID" },
  { command: "import", description: "How to upload an Excel file" },
  { command: "search", description: "Search customer by phone, ID, or name" },
  { command: "stats", description: "Show sales database totals" },
];

module.exports = {
  adminIds,
  commands,
  keyboard,
};
