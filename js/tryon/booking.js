// ---------------------------------------------------------------------------
// js/tryon/booking.js — pure booking logic (no DOM).
// Used by app.js (UI) and by the test suite — the business rules live here,
// not inside components.
//
// Hard rule (per project brief): the site NEVER claims a slot is reserved.
// It only prepares a draft message; final coordination happens with the artist.
// ---------------------------------------------------------------------------

export const PHONE_NUMBER = "09058674412";
export const WHATSAPP_NUMBER = "989058674412";
export const INSTAGRAM_HANDLE = "@asalrajabi_pmu";
export const INSTAGRAM_URL = "https://ig.me/m/asalrajabi_pmu";

export const BOOKING_SUCCESS_TEXT = "درخواست شما آماده ارسال برای هماهنگی است.";
export const BOOKING_DISCLAIMER =
  "این پیام یک پیش‌نویس است؛ با ارسالش در واتساپ یا اینستاگرام، هماهنگی نهایی بر اساس موجودی وقت انجام می‌شود. تا تأیید شما، نوبت ثبت یا رزرو نشده است.";

/**
 * Normalize an Iranian mobile number.
 * '09058674412', '0098 905 867 4412', '+98-905-867-4412' → '9058674412'
 * Returns '' when the input is not a valid 10-digit mobile.
 */
export function normalizePhone(input) {
  let s = String(input || "")
    .replace(/[\s\-()]/g, "")
    .replace(/^(?:\+?98|0098)/, "");
  if (s.startsWith("0")) s = s.slice(1);
  if (!/^9\d{9}$/.test(s)) return "";
  return s;
}

export function validPhone(input) {
  return normalizePhone(input).length > 0;
}

/**
 * Build the wa.me deep link with the pre-filled booking request.
 * `phone` must be the normalized form (9XXXXXXXXX).
 */
export function buildWaDraft({ serviceLabel, styleLabel, name, phone, time, note }) {
  const lines = [
    "سلام عسل جان، از سایت دیدمت 🌸",
    "می‌خوام این مدل رو سفارش بدم:",
    `• خدمات: ${serviceLabel}`,
  ];
  if (styleLabel) lines.push(`• مدل: ${styleLabel}`);
  lines.push(`• نام: ${name}`, `• موبایل: 0${phone}`);
  if (time) lines.push(`• زمان دلخواه: ${time}`);
  if (note) lines.push(`• یادداشت: ${note}`);
  lines.push("(این پیام از اپلیکیشن تست مجازی عسل رجبی PMU ساخته شد)");
  return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(lines.join("\n"))}`;
}
