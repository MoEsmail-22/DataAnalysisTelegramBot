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

The bot also shows Arabic shortcut buttons:

- بحث
- رفع Excel
- إحصائيات
- مساعدة

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
