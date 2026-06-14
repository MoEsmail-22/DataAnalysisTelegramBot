# 04 - إصلاح Google Sheets invalid_grant

## معنى الخطأ

الخطأ:

```text
invalid_grant: Invalid JWT Signature
```

يعني أن Google رفض توقيع الـ JWT الخاص بالـ service account.

الأسباب الأشهر:

1. مفتاح الـ service account تم حذفه أو تغييره من Google Cloud.
2. المفتاح الموجود في السيرفر لا يطابق `client_email`.
3. قيمة `private_key` اتكسرت أثناء وضعها في Environment Variables.
4. وقت السيرفر غير مضبوط.

## ماذا تم تعديله في الكود

الكود الآن يدعم 3 طرق لقراءة credentials:

```env
GOOGLE_SHEETS_CREDENTIALS_BASE64=...
```

أو:

```env
GOOGLE_SHEETS_CREDENTIALS_PATH=./service-account.json
```

أو:

```env
GOOGLE_SHEETS_CREDENTIALS={...json...}
```

الأفضل للسيرفر هو `GOOGLE_SHEETS_CREDENTIALS_BASE64`.

## أفضل حل للسيرفر

1. افتح Google Cloud.
2. افتح Service Accounts.
3. اختر نفس service account.
4. احذف المفتاح القديم إذا كان مشكوك فيه.
5. أنشئ JSON key جديد.
6. شارك Google Sheet مع `client_email` الموجود في JSON.
7. حول ملف JSON إلى Base64.

في PowerShell:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\path\service-account.json"))
```

8. ضع الناتج في السيرفر:

```env
GOOGLE_SHEETS_CREDENTIALS_BASE64=base64_output_here
```

9. احذف أو لا تستخدم:

```env
GOOGLE_SHEETS_CREDENTIALS
GOOGLE_SHEETS_CREDENTIALS_PATH
```

10. أعد تشغيل السيرفر.

## مهم جدا

لا ترفع ملف JSON إلى GitHub.

ملف `.gitignore` يمنع الآن هذه الملفات:

```text
elhamy-bot-*.json
service-account*.json
```
