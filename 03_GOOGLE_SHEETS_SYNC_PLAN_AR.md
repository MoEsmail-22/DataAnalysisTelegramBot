# 03 - خطة ربط Google Sheets مستقبلا

## مهم

هذا الملف شرح فقط. لم يتم بناء Google Sheets sync الآن.

الفكرة: بدلا من رفع Excel كل مرة، يتم ربط البوت بملف Google Sheet، وعند إضافة صف جديد يتم تحديث قاعدة البيانات تلقائيا.

## أفضل طريقة مقترحة

استخدام Google Sheets API مع مهمة sync تعمل كل فترة.

النظام سيكون هكذا:

1. Google Sheet يحتوي نفس الأعمدة:
   - الهاتف 001
   - اسم العميل
   - الهاتف 0012
   - الهاتف 002
   - الهاتف 003
   - المحافظة
   - Zone
   - Area
   - العنوان
   - العنوان 02
   - العنوان 03
   - ملحوظة

2. السيرفر يقرأ الشيت كل 5 أو 10 دقائق.
3. كل صف يتم تحويله لنفس شكل `customer_profiles`.
4. قاعدة البيانات تعمل insert أو update باستخدام `primary_phone`.
5. البوت يبحث من Supabase كالمعتاد.

## المطلوب من Google

ستحتاج إلى:

1. Google Cloud Project.
2. تفعيل Google Sheets API.
3. إنشاء Service Account.
4. تحميل JSON credentials.
5. مشاركة Google Sheet مع email الخاص بالـ Service Account.

## Environment Variables المطلوبة مستقبلا

يمكن إضافة:

```env
GOOGLE_SHEET_ID=sheet_id_here
GOOGLE_SHEET_NAME=Data
GOOGLE_SERVICE_ACCOUNT_EMAIL=service_account_email
GOOGLE_PRIVATE_KEY=private_key
SYNC_INTERVAL_MINUTES=10
```

## أين يوجد Sheet ID

لو رابط Google Sheet مثل:

```text
https://docs.google.com/spreadsheets/d/1ABCDEF123456789/edit
```

فالـ Sheet ID هو:

```text
1ABCDEF123456789
```

## طريقتان للتحديث التلقائي

### الطريقة 1 - Polling كل فترة

السيرفر كل 10 دقائق يقرأ Google Sheet بالكامل ويحدث Supabase.

المميزات:

- أسهل في التنفيذ.
- لا يحتاج Webhooks من Google.
- مناسب لحجم بيانات متوسط.

العيوب:

- التحديث ليس لحظيا.
- قد يقرأ الشيت بالكامل كل مرة.

### الطريقة 2 - Google Apps Script Webhook

عند إضافة صف جديد في Google Sheet، Apps Script يرسل الصف إلى API في السيرفر.

المميزات:

- أسرع.
- لا يحتاج قراءة الملف بالكامل كل مرة.

العيوب:

- إعداداته أصعب.
- يحتاج API endpoint آمن.
- يحتاج secret token لحماية endpoint.

## التوصية

ابدأ بالطريقة الأولى:

```text
Google Sheets API + sync every 10 minutes
```

لأنها أبسط وأكثر استقرارا كبداية.

## خطوات البناء لاحقا

1. إضافة مكتبة Google:

```bash
npm install googleapis
```

2. إنشاء ملف:

```text
src/googleSheets.js
```

3. عمل function تقرأ الصفوف من Google Sheet.

4. استخدام نفس منطق Excel parser لتحويل الصفوف.

5. إضافة function:

```text
syncGoogleSheet()
```

6. تشغيلها عند بداية السيرفر ثم كل 10 دقائق.

7. إضافة أمر أدمن:

```text
مزامنة
```

لكي يستطيع الأدمن تشغيل sync يدويا من Telegram.

## ملاحظة مهمة

لو السيرفر الحالي لا يدعم تشغيل process دائم أو cron jobs، يجب التأكد من لوحة `cloud.tranger.xyz` هل تدعم:

- دائم التشغيل
- scheduled tasks
- cron
- background worker

إذا لا تدعم ذلك، يمكن استخدام Apps Script webhook بدلا من polling.
