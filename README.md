# Telegram Arabic Customer Data Bot

Telegram bot that syncs customer data from a Google Sheet into Supabase/PostgreSQL and allows searching customer delivery information by phone number or name.

## What It Stores

Each customer can have:

- Arabic customer name
- Up to 3 phone numbers
- Governorate
- Zone
- Area
- Up to 3 addresses
- Notes
- Full original row stored in `raw_data`

The bot replies in Arabic.

## Environment

Create `.env` locally, or add these environment variables in your hosting dashboard:

```env
BOT_TOKEN=your_new_bot_token
DATABASE_URL=your_supabase_postgres_connection_string
ADMIN_IDS=123456789,987654321

# Google Sheets Sync
GOOGLE_SHEETS_CREDENTIALS={"type":"service_account",...}
GOOGLE_SHEET_ID=1kc_LVn-KyxUuBhY37rLpC5BvkfCC15MiTbEfLS5055w
GOOGLE_SHEET_NAME=Data
SYNC_INTERVAL_MINUTES=10
```

`ADMIN_IDS` is a comma-separated list of Telegram user IDs. Admins can trigger manual sync and view stats. Normal users can search only.

## Install

```bash
npm install
```

## Database

Run `schema.sql` in Supabase SQL Editor before the bot starts syncing data.

## Start Locally

```bash
npm start
```

## Bot Commands

- `/start` - فتح القائمة
- `/help` - عرض المساعدة
- `/myid` - إظهار رقم حسابك
- `/search phone_or_name` - بحث برقم الهاتف أو الاسم
- `/stats` - إحصائيات البيانات
- `/sync` - مزامنة من Google Sheet يدويا

The bot also shows Arabic shortcut buttons:

- بحث
- مزامنة
- إحصائيات
- مساعدة

## Google Sheets Configuration

The bot syncs customer data directly from a Google Sheet. Setup is required.

### Setup Steps

1. **Create a Google Cloud Project:**
   - Go to [Google Cloud Console](https://console.cloud.google.com/)
   - Create a new project

2. **Enable Google Sheets API:**
   - In the APIs & Services section, enable "Google Sheets API"

3. **Create a Service Account:**
   - In APIs & Services → Credentials
   - Create a new Service Account
   - Download the JSON key file

4. **Share your Google Sheet:**
   - Copy the service account email from the JSON file
   - Share your Google Sheet with that email address (give it Editor access)

5. **Configure Environment Variables:**
   ```env
   GOOGLE_SHEETS_CREDENTIALS={"type":"service_account","project_id":"..."}
   GOOGLE_SHEET_ID=1kc_LVn-KyxUuBhY37rLpC5BvkfCC15MiTbEfLS5055w
   GOOGLE_SHEET_NAME=Data
   SYNC_INTERVAL_MINUTES=10
   ```

### Google Sheet Column Format

Your Google Sheet must have these columns (can be in any order):

- `الهاتف 001` - main phone number (primary key for updates)
- `اسم العميل` - customer name
- `الهاتف 0012` - duplicate-check phone
- `الهاتف 002` - second phone
- `الهاتف 003` - third phone
- `المحافظة` - governorate
- `Zone` - zone
- `Area` - area
- `العنوان` - first address
- `العنوان 02` - second address
- `العنوان 03` - third address
- `ملحوظة` - notes

### How Sync Works

1. Bot reads all rows from the specified Google Sheet automatically every 10 minutes
2. Parses and normalizes the data
3. Updates the database using the primary phone number (`الهاتف 001`) as the key
4. Admins can manually trigger sync anytime using `/sync` or مزامنة button
5. Errors are logged to the server console

## Deployment

For hosting platforms such as `cloud.tranger.xyz`, push the latest code to GitHub, then redeploy/restart the bot from the hosting dashboard. Make sure the hosting environment variables match the `.env` values above.
