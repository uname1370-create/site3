# عسل رجبی PMU — سایت + موتور تست مجازی واقعی

وب‌سایت پریمیوم «عسل رجبی» (مشهد — برج پاژ) با **تست مجازی واقعی** میکروبلیدینگ،
شیدینگ لب و خط چشم: نتیجه روی **صورت خودتان** از هندسهٔ واقعی عکس محاسبه می‌شود
(۴۷۸ لندمارک → تحلیل → warp غیرصلب → ماسک دقیق → pigmentation حفظ‌کنندهٔ بافت).

- 📱 Mobile-first · PWA (installable، Safari iOS + Chrome Android)
- 🔒 پردازش عکس **کاملاً در مرورگر** — هیچ آپلودی
- ✦ دو حالت: پیش‌نمایش سریع + رندر باکیفیت
- 🎚 قبل/بعد با اسلایدر + اسلایدر شید + دانلود PNG
- 📩 رزرو با سیت: پیش‌نویس واتساپ/اینستاگرام/تماس — «درخواست شما آماده ارسال برای هماهنگی است.»

## اجرا

```bash
# تست موتور (Node خالص، بدون مرورگر)
node test/engine.test.mjs        # ۳۳/۳۳

# سایت
python3 -m http.server 8080 --bind 0.0.0.0
# → http://localhost:8080
# → http://localhost:8080/?debug=1   (پنل دیباگ توسعه: لندمارک/ماسک/warp)
```

## ساختار

```
index.html            صفحهٔ اصلی (PWA, RTL, سیستم طراحی برند)
sw.js                 service worker (offline shell)
manifest.webmanifest  manifest PWA
icons/                آیکون‌ها (tools/make-icons.mjs)
js/tryon/
  app.js              orchestrator UI
  booking.js          منطق خالص رزرو (تست‌پذیر)
  faceAnalyzer.js     MediaPipe FaceLandmarker + gate کیفیت
  landmarks.js        ۴۷۸ لندمارک → مناطق صورت
  pose.js             yaw/pitch/roll
  pipeline.js         renderTryOn (fast/high)
  styles.js           سبک‌ها
  brow/               detect ابروی واقعی + PMUBrowModel + fit + render
  lip/                colorize LAB + render (دندان/دهان داخلی دست‌نخورده)
  liner/              منحنی مژه → مسیر/پنای متغیر/بال
  debug/overlay.js    لایه‌های دیباگ
  lib/                vec (Delaunay/TPS/affine) · image · lab · canvasPath
test/engine.test.mjs  ۳۳ تست ریاضی/منطق
tools/make-icons.mjs  تولید آیکون (بدون وابستگی)
admin.html            پنل مدیریت (موجود از قبل)
REPORT.md             گزارش کامل ۸ بخشی
```

## مخاطب

«تو زیبایی؛ من فقط کشفش می‌کنم 🪄» · IG [@asalrajabi_pmu](https://ig.me/m/asalrajabi_pmu) · 📞 ۰۹۰۵۸۶۷۴۴۱۲
