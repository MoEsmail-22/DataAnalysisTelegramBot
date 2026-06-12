# Telegram Excel PostgreSQL Bot

This is a clean Node.js structure for the bot you described:

- Telegram bot receives sales Excel files.
- Excel rows are parsed with SheetJS.
- Data is inserted into PostgreSQL/Supabase.
- Users can search customer sales summaries by phone, ID, or name.

## Setup

1. Revoke the leaked Telegram token in BotFather and generate a new one.
2. Copy `.env.example` to `.env`.
3. Put your real values in `.env`.

```env
BOT_TOKEN=your_new_bot_token
DATABASE_URL=postgresql://postgres:password@host:5432/postgres
ADMIN_IDS=123456789,987654321
```

Use the Supabase PostgreSQL connection string, not the REST API URL.

`ADMIN_IDS` is a comma-separated list of Telegram user IDs. Admins can upload Excel files and view stats. Normal users can search only.

## Install

```bash
npm install
```

## Database

Run `schema.sql` in Supabase SQL Editor or your PostgreSQL client.

## Start

```bash
npm start
```

## Deploy Without A Card: Vercel Webhook

Vercel does not keep `npm start` running forever, so production deployment uses Telegram webhook mode through `api/webhook.js`.

1. Deploy this repo on Vercel as a Node.js project.
2. If you use the Vercel CLI, install the Vercel plugin:

```bash
npx plugins add vercel/vercel-plugin
```

3. Add these environment variables in Vercel:

```env
BOT_TOKEN=your_new_bot_token
DATABASE_URL=your_supabase_postgres_connection_string
ADMIN_IDS=123456789,987654321
```

4. After deployment, copy your Vercel URL and set the Telegram webhook:

```bash
WEBHOOK_URL=https://data-analysis-telegram-bfoooyxu3-moesmail-22s-projects.vercel.app/api/webhook npm run set-webhook
```

On Windows PowerShell:

```powershell
$env:WEBHOOK_URL="https://data-analysis-telegram-bfoooyxu3-moesmail-22s-projects.vercel.app/api/webhook"; npm run set-webhook
```

5. Stop the local polling bot with `Ctrl + C`.

## Bot Commands

- `/start` - open the bot menu
- `/help` - show commands and shortcuts
- `/myid` - show your Telegram user ID
- `/import` - explain how to upload an Excel file
- `/search phone_id_or_name` - show a customer sales summary
- `/stats` - show sales record, customer, and amount totals

The bot also shows shortcut buttons for Search, Import Excel, Stats, and Help.

## Admin Setup

1. Start the bot.
2. Send `/myid` from your Telegram account.
3. Copy the number into `.env`.

```env
ADMIN_IDS=123456789
```

For multiple admins:

```env
ADMIN_IDS=123456789,987654321
```

Restart the bot after changing `.env`.

## Excel Columns

The parser accepts common column names:

- Customer name: `customer_name`, `name`, `full_name`, `client_name`
- Phone: `phone`, `phone_number`, `customer_phone`, `mobile`, `mobile_number`, `telephone`
- Address: `address`, `customer_address`, `location`
- Purchase: `purchase`, `purchases`, `product`, `item`, `service`
- Purchase date: `purchase_date`, `date_of_purchase`, `date`, `order_date`
- Transactions: `number_of_transactions`, `transactions`, `transaction_count`
- Quantity: `quantity`, `qty`, `qouinity`
- Amount: `amount`, `total`, `price`, `value`, `paid`
- ID: `id`, `customer_id`, `client_id`, `code`

You can add your exact Excel headers in `src/excel.js`.
