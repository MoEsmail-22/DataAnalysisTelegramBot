# Telegram Arabic Customer Data Bot

Telegram bot for importing the main Arabic Excel customer file into Supabase/PostgreSQL and searching customer delivery data by phone number or name.

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
```

`ADMIN_IDS` is a comma-separated list of Telegram user IDs. Admins can upload Excel files and view stats. Normal users can search only.

## Install

```bash
npm install
```

## Database

Run `schema.sql` in Supabase SQL Editor before importing the Excel file.

## Start Locally

```bash
npm start
```

## Bot Commands

- `/start` - فتح القائمة
- `/help` - عرض المساعدة
- `/myid` - إظهار رقم حسابك
- `/import` - رفع ملف Excel
- `/search phone_or_name` - بحث برقم الهاتف أو الاسم
- `/stats` - إحصائيات البيانات
- `/sync` - مزامنة من Google Sheet يدويا

The bot also shows Arabic shortcut buttons:

- بحث
- رفع Excel
- إحصائيات
- مساعدة
- مزامنة

## Google Sheets Sync (Optional)

Instead of uploading Excel files manually, you can sync customer data directly from a Google Sheet. The bot can read from a Google Sheet automatically every 10 minutes (configurable).

### Setup Google Sheets Sync

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
   GOOGLE_SHEET_ID=1ABCDEF123456789
   GOOGLE_SHEET_NAME=Data
   SYNC_INTERVAL_MINUTES=10
   ```

   - `GOOGLE_SHEETS_CREDENTIALS`: Full JSON content from the downloaded key file
   - `GOOGLE_SHEET_ID`: The ID from the sheet URL (between `/d/` and `/edit`)
   - `GOOGLE_SHEET_NAME`: The name of the sheet tab (default: "Data")
   - `SYNC_INTERVAL_MINUTES`: How often to sync (default: 10)

### Google Sheet Format

Your Google Sheet should have the same columns as the Excel file:

- `الهاتف 001` - main phone number
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

### Manual Sync

Admins can trigger a manual sync at any time using:
- `/sync` command
- مزامنة button in the bot keyboard

### How It Works

1. Bot reads all rows from the specified Google Sheet
2. Parses and normalizes the data (same as Excel parser)
3. Updates the database using the primary phone number as the key
4. Sync runs automatically every configured interval (default: 10 minutes)
5. Admins can also trigger sync manually anytime

## Excel Columns

The production Excel file uses these columns:

- `الهاتف 001` - main phone number, used as the primary update key
- `اسم العميل` - customer name
- `الهاتف 0012` - duplicate-check phone column
- `الهاتف 002` - second phone number
- `الهاتف 003` - third phone number
- `المحافظة` - governorate
- `Zone` - zone
- `Area` - area
- `العنوان` - first address
- `العنوان 02` - second address
- `العنوان 03` - third address
- `ملحوظة` - notes

The first numeric header row in the workbook is ignored automatically. The parser detects the Arabic header row.

## Deployment

For hosting platforms such as `cloud.tranger.xyz`, push the latest code to GitHub, then redeploy/restart the bot from the hosting dashboard. Make sure the hosting environment variables match the `.env` values above.
