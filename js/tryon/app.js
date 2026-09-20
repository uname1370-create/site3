// ---------------------------------------------------------------------------
// app.js — UI orchestrator for the عسل رجبی PMU try-on.
//
// Wires the page (index.html) to the deterministic engine:
//   upload → quality gate (Persian feedback) → fast preview render →
//   before/after slider · style & shade live re-render → explicit high-quality
//   render · PNG download · booking sheet (bottom sheet / modal) · debug
//   overlay behind ?debug=1 · service worker registration.
//
// Business rules (from the brief):
//  - never claim a booking is confirmed — only "آماده ارسال برای هماهنگی"
//  - the client-side processing note is shown only after a real render
//  - every failure shows a clear Persian message + retry, never a white screen
// ---------------------------------------------------------------------------

import { createFaceAnalyzer, AnalysisError } from "./faceAnalyzer.js";
import { renderTryOn } from "./pipeline.js";
import { SERVICES, LIP_STYLES, BROW_STYLES, LINER_STYLES } from "./styles.js";
import { drawDebugOverlay, DEBUG_LAYERS } from "./debug/overlay.js";
import {
  PHONE_NUMBER,
  WHATSAPP_NUMBER,
  INSTAGRAM_URL,
  BOOKING_SUCCESS_TEXT,
  BOOKING_DISCLAIMER,
  normalizePhone,
  buildWaDraft,
} from "./booking.js";

const SERVICE_LABELS = {
  brow: "میکروبلیدینگ",
  lip: "شیدینگ لب",
  liner: "خط چشم",
  remove: "ریموو",
};

const STAGE_TEXT = {
  render: "آماده‌سازی تصویر…",
  "brow-0": "شناسایی ابروی چپ…",
  "brow-1": "شناسایی ابروی راست…",
  lip: "شیدینگ لب…",
  "liner-0": "ساخت خط چشم…",
  "liner-1": "ساخت خط چشم…",
};

const state = {
  service: "brow",
  styleId: null,
  img: null,
  analysis: null,
  result: null,
  intensity: 0.55,
  quality: "fast",
  fullView: false,
  split: 0.5,
  debugOn: new URLSearchParams(location.search).has("debug"),
  debugLayers: { landmarks: false, roi: true, natural: true, target: true, controlPoints: false, strokes: false },
  renderToken: 0,
  drag: false,
};

// ---------------------------------------------------------------------------
// Elements
// ---------------------------------------------------------------------------

const $ = (id) => document.getElementById(id);
const els = {
  serviceBtns: document.querySelectorAll(".service-btn"),
  fileInput: $("fileInput"),
  dropzone: $("dropzone"),
  placeholder: $("placeholder"),
  placeholderText: $("placeholderText"),
  placeholderSpinner: $("placeholderSpinner"),
  placeholderIcon: $("placeholderIcon"),
  placeholderExtra: $("placeholderExtra"),
  compare: $("compare"),
  beforeWrap: $("beforeWrap"),
  beforeCanvas: $("beforeCanvas"),
  afterCanvas: $("afterCanvas"),
  debugCanvas: $("debugCanvas"),
  sliderHandle: $("sliderHandle"),
  processing: $("processing"),
  processingText: $("processingText"),
  styleRow: $("styleRow"),
  shadeSlider: $("shadeSlider"),
  fullView: $("fullView"),
  fullViewLabel: $("fullViewLabel"),
  wantThis: $("wantThis"),
  hqBtn: $("hqBtn"),
  downloadBtn: $("downloadBtn"),
  resultRow: $("resultRow"),
  privacyNote: $("privacyNote"),
  debugPanel: $("debugPanel"),
  debugLayersRow: $("debugLayers"),
  sheetBtn: $("sheetBtn"),
  waDirect: $("waDirect"),
  sheetRoot: $("sheetRoot"),
  toast: $("toast"),
};

els.waDirect.href = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent("سلام عسل جان 🌿 می‌خوام برای میکروبلیدینگ/شیدینگ هماهنگ کنم.")}`;

const analyzer = createFaceAnalyzer();
const stylesOf = (service) =>
  service === "brow"
    ? Object.values(BROW_STYLES)
    : service === "lip"
      ? LIP_STYLES
      : Object.values(LINER_STYLES);

state.styleId = stylesOf(state.service)[0].id;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

let toastTimer = 0;
function toast(text) {
  if (!els.toast) return;
  els.toast.textContent = text;
  els.toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove("show"), 2800);
}

function showProcessing(text) {
  els.processingText.textContent = text || "در حال پردازش…";
  els.processing.classList.remove("hidden");
  els.processing.classList.add("flex");
}
function hideProcessing() {
  els.processing.classList.add("hidden");
  els.processing.classList.remove("flex");
}

function showPlaceholder(text, opts = {}) {
  els.placeholder.classList.remove("hidden");
  els.compare.classList.add("hidden");
  els.placeholderText.textContent = text;
  els.placeholderSpinner.classList.toggle("hidden", !opts.spinner);
  els.placeholderIcon.classList.toggle("hidden", !opts.icon);
  els.placeholderExtra.innerHTML = "";
  if (opts.retry) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "gold-btn min-h-[44px] rounded-2xl px-6 text-[13px] font-bold";
    b.textContent = "دوباره تلاش کن";
    b.addEventListener("click", () => els.fileInput.click());
    els.placeholderExtra.appendChild(b);
  }
}

function showCompare() {
  els.placeholder.classList.add("hidden");
  els.compare.classList.remove("hidden");
}

function fail(message) {
  state.analysis = null;
  state.result = null;
  showPlaceholder(message, { icon: true, retry: true });
  els.wantThis.disabled = true;
  els.wantThis.classList.add("opacity-50");
  els.resultRow.classList.add("hidden");
  els.privacyNote.classList.add("hidden");
}

// ---------------------------------------------------------------------------
// Style chips + service switching
// ---------------------------------------------------------------------------

function renderStyles() {
  const list = stylesOf(state.service);
  if (!list.some((s) => s.id === state.styleId)) state.styleId = list[0].id;
  const basis = list.length <= 4 ? "basis-[46%]" : "basis-[30%]";
  els.styleRow.innerHTML = list
    .map(
      (s) => `
    <button type="button" data-style="${s.id}"
      class="style-chip chip ${basis} grow rounded-2xl px-2 py-2.5 text-center ${s.id === state.styleId ? "active" : ""}">
      ${
        state.service === "lip"
          ? `<span class="mx-auto mb-1.5 block h-3 w-3 rounded-full ring-1 ring-black/10" style="background:${s.color}"></span>`
          : ""
      }
      <span class="block text-[12px] font-bold leading-5">${s.name}</span>
      <span class="mt-0.5 block text-[10px] font-light leading-4 opacity-70">${s.hint}</span>
    </button>`
    )
    .join("");
  els.styleRow.querySelectorAll(".style-chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.styleId = btn.dataset.style;
      renderStyles();
      if (state.result) void renderCurrent(state.quality);
    });
  });
}

function syncWantThis() {
  const on = !!state.result;
  els.wantThis.disabled = !on;
  els.wantThis.classList.toggle("opacity-50", !on);
}

els.serviceBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    const svc = btn.dataset.service;
    if (svc === "remove") {
      // Removal is a booking-only service — straight to the sheet.
      openSheet({ service: "remove", styleId: null, thumb: null });
      return;
    }
    state.service = svc;
    state.styleId = stylesOf(svc)[0].id;
    els.serviceBtns.forEach((b) => b.classList.toggle("active", b === btn));
    renderStyles();
    if (state.result) void renderCurrent(state.quality);
    else if (state.analysis && !state.analysis.errors.length) {
      state.img && void renderCurrent("fast");
    }
  });
});

// ---------------------------------------------------------------------------
// Compare layout & painting
// ---------------------------------------------------------------------------

function dpr() {
  return Math.min(window.devicePixelRatio || 1, 3);
}

function setupCanvas(canvas, w, h) {
  const r = dpr();
  canvas.width = Math.round(w * r);
  canvas.height = Math.round(h * r);
  canvas.style.width = w + "px";
  canvas.style.height = h + "px";
  const ctx = canvas.getContext("2d");
  ctx.setTransform(r, 0, 0, r, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  return ctx;
}

function bboxOf(pts) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) {
    if (p.x < x0) x0 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.x > x1) x1 = p.x;
    if (p.y > y1) y1 = p.y;
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Face-relative crop in native-image fractions (kept service-aware, like the
 *  pro view: brows with forehead, lips with chin margin, eyes with lids). */
function cropFractions() {
  if (!state.analysis || state.fullView) return { x: 0, y: 0, w: 1, h: 1 };
  const reg = state.analysis.regions;
  const { w: fw, h: fh } = reg.faceBounds;
  let b;
  if (state.service === "brow") b = bboxOf(reg.sides[0].browTop.concat(reg.sides[1].browTop));
  else if (state.service === "lip") b = bboxOf(reg.lips.outer);
  else b = bboxOf(reg.sides[0].eyeTop.concat(reg.sides[1].eyeTop));
  const padX = b.w * 0.22;
  const padY = {
    brow: { top: fw * 0.16, bottom: fw * 0.1 },
    lip: { top: fw * 0.12, bottom: fw * 0.22 },
    liner: { top: fw * 0.14, bottom: fw * 0.12 },
  }[state.service];
  let x = (b.x - padX) / fw;
  let y = (b.y - padY.top) / fh;
  let w = (b.w + padX * 2) / fw;
  let h = (b.h + padY.top + padY.bottom) / fh;
  // clamp to frame
  const cx = Math.max(0, Math.min(1 - w, x));
  const cy = Math.max(0, Math.min(1 - h, y));
  return { x: cx, y: cy, w, h };
}

let displayW = 0;
let displayH = 0;

function layoutCompare() {
  const img = state.img;
  if (!img) return;
  const maxW = els.compare.parentElement.clientWidth || 360;
  const nw = img.naturalWidth || img.width;
  const nh = img.naturalHeight || img.height;
  const c = cropFractions();
  const aspect = (c.w * nw) / (c.h * nh);
  displayW = maxW;
  displayH = Math.max(120, Math.round(maxW / aspect));
  setupCanvas(els.afterCanvas, displayW, displayH);
  setupCanvas(els.beforeCanvas, displayW, displayH);
  setupCanvas(els.debugCanvas, displayW, displayH);
  applySplit(state.split);
}

function applySplit(t) {
  state.split = Math.min(0.92, Math.max(0.08, t));
  const pct = (state.split * 100).toFixed(2) + "%";
  els.beforeWrap.style.width = pct;
  els.sliderHandle.style.left = pct;
}

function pointerToSplit(clientX) {
  const rect = els.compare.getBoundingClientRect();
  return (clientX - rect.left) / rect.width;
}

els.compare.addEventListener("pointerdown", (e) => {
  els.compare.setPointerCapture(e.pointerId);
  state.drag = true;
  applySplit(pointerToSplit(e.clientX));
});
els.compare.addEventListener("pointermove", (e) => {
  if (state.drag) applySplit(pointerToSplit(e.clientX));
});
els.compare.addEventListener("pointerup", () => (state.drag = false));
els.compare.addEventListener("pointercancel", () => (state.drag = false));

function paintCompare() {
  const img = state.img;
  if (!img) return;
  const nw = img.naturalWidth || img.width;
  const nh = img.naturalHeight || img.height;
  const c = cropFractions();
  const sx = c.x * nw;
  const sy = c.y * nh;
  const sw = c.w * nw;
  const sh = c.h * nh;

  const bctx = setupCanvas(els.beforeCanvas, displayW, displayH);
  bctx.clearRect(0, 0, displayW, displayH);
  bctx.drawImage(img, sx, sy, sw, sh, 0, 0, displayW, displayH);

  const actx = setupCanvas(els.afterCanvas, displayW, displayH);
  actx.clearRect(0, 0, displayW, displayH);
  if (state.result) {
    const rc = state.result.canvas;
    // blit the same crop from the render-resolution frame
    actx.drawImage(rc, c.x * rc.width, c.y * rc.height, c.w * rc.width, c.h * rc.height, 0, 0, displayW, displayH);
  } else {
    actx.drawImage(img, sx, sy, sw, sh, 0, 0, displayW, displayH);
  }

  // debug overlay (render-resolution coordinates)
  if (state.debugOn && state.result) {
    els.debugCanvas.classList.remove("hidden");
    const dctx = setupCanvas(els.debugCanvas, displayW, displayH);
    const rc = state.result.canvas;
    dctx.save();
    dctx.scale(displayW / rc.width, displayH / rc.height);
    drawDebugOverlay(dctx, rc.width, rc.height, state.result.debug, state.debugLayers);
    dctx.restore();
  } else {
    els.debugCanvas.classList.add("hidden");
  }
}

// ---------------------------------------------------------------------------
// Image intake + analysis + render
// ---------------------------------------------------------------------------

function fileToImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("fail"));
    };
    img.src = url;
  });
}

function loadSrc(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("fail"));
    img.src = src;
  });
}

async function processImage(img) {
  const token = ++state.renderToken;
  showCompare();
  layoutCompare();
  paintCompare(); // show the original while analyzing
  showProcessing("در حال تشخیص چهره…");

  let analysis;
  try {
    analysis = await analyzer.analyze(img);
  } catch (e) {
    if (token !== state.renderToken) return;
    hideProcessing();
    fail(e instanceof AnalysisError ? e.message : "خطا در پردازش عکس. دوباره تلاش کن.");
    return;
  }
  if (token !== state.renderToken) return;

  if (analysis.errors.length) {
    hideProcessing();
    fail(analysis.errors[0]);
    return;
  }

  state.analysis = analysis;
  state.img = img;
  layoutCompare();
  await renderCurrent("fast", token);
  if (token !== state.renderToken) return;

  els.resultRow.classList.remove("hidden");
  els.privacyNote.classList.remove("hidden");
  syncWantThis();
  setHqLabel();
  if (analysis.warnings.length) toast(analysis.warnings[0]);
  document.getElementById("magic").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function renderCurrent(quality, token) {
  if (!state.analysis) return;
  token = token ?? ++state.renderToken;
  state.quality = quality;
  showProcessing(quality === "high" ? "در حال رندر با کیفیت بالا…" : "در حال ساخت نتیجه…");
  try {
    const res = await renderTryOn({
      source: state.img,
      analysis: state.analysis,
      service: state.service,
      styleId: state.styleId,
      quality,
      intensity: state.intensity,
      onStage: (s) => {
        if (token === state.renderToken) els.processingText.textContent = STAGE_TEXT[s] || "در حال پردازش…";
      },
    });
    if (token !== state.renderToken) return;
    state.result = res;
    hideProcessing();
    layoutCompare();
    paintCompare();
    syncWantThis();
    setHqLabel();
  } catch (e) {
    console.error(e);
    if (token !== state.renderToken) return;
    hideProcessing();
    fail("خطا در ساخت نتیجه. دوباره تلاش کن.");
  }
}

function setHqLabel() {
  const on = state.quality === "high";
  els.hqBtn.innerHTML = on ? "✦ کیفیت بالا فعال است" : "✦ رندر با کیفیت بالا";
  els.hqBtn.classList.toggle("active", on);
}

els.hqBtn.addEventListener("click", () => {
  if (state.analysis && !state.analysis.errors.length) void renderCurrent("high");
});

// shade slider with a short debounce (re-render is the expensive part)
let shadeTimer = 0;
els.shadeSlider.addEventListener("input", () => {
  state.intensity = Number(els.shadeSlider.value) / 100;
  clearTimeout(shadeTimer);
  shadeTimer = setTimeout(() => {
    if (state.result) void renderCurrent(state.quality);
  }, 200);
});
els.shadeSlider.addEventListener("pointerdown", (e) => e.stopPropagation());

els.fullView.addEventListener("change", () => {
  state.fullView = els.fullView.checked;
  els.fullViewLabel.classList.toggle("active", state.fullView);
  layoutCompare();
  paintCompare();
});

// upload: file input
els.fileInput.addEventListener("change", async (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  try {
    await processImage(await fileToImage(file));
  } catch (err) {
    console.error(err);
    fail("آپلود عکس ناموفق بود. دوباره تلاش کن.");
  } finally {
    els.fileInput.value = "";
  }
});

// upload: drag & drop
["dragenter", "dragover"].forEach((ev) =>
  els.dropzone.addEventListener(ev, (e) => {
    e.preventDefault();
    els.dropzone.classList.add("dragover");
  })
);
["dragleave", "drop"].forEach((ev) =>
  els.dropzone.addEventListener(ev, (e) => {
    e.preventDefault();
    els.dropzone.classList.remove("dragover");
  })
);
els.dropzone.addEventListener("drop", async (e) => {
  const file = e.dataTransfer.files && e.dataTransfer.files[0];
  if (!file || !file.type.startsWith("image/")) return;
  try {
    await processImage(await fileToImage(file));
  } catch (err) {
    console.error(err);
  }
});

// upload: sample photos
document.querySelectorAll(".preset-btn").forEach((btn) => {
  btn.addEventListener("click", async () => {
    try {
      showCompare();
      showProcessing("در حال بارگذاری عکس نمونه…");
      await processImage(await loadSrc(btn.dataset.src));
    } catch (err) {
      console.error(err);
      hideProcessing();
      fail("بارگذاری عکس نمونه ناموفق بود. دوباره تلاش کن.");
    }
  });
});

// resize
let resizeTimer = 0;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (!state.img) return;
    layoutCompare();
    paintCompare();
  }, 140);
});

// ---------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------

els.downloadBtn.addEventListener("click", () => {
  if (!state.result) return;
  const rc = state.result.canvas;
  const c = cropFractions();
  // export exactly what the user sees (the cropped "after" view)
  const out = document.createElement("canvas");
  out.width = Math.max(2, Math.round(c.w * rc.width));
  out.height = Math.max(2, Math.round(c.h * rc.height));
  out.getContext("2d").drawImage(rc, c.x * rc.width, c.y * rc.height, c.w * rc.width, c.h * rc.height, 0, 0, out.width, out.height);
  const name = `asalrajabi-pmu_${state.service}_${state.styleId}.png`;
  out.toBlob((blob) => {
    if (!blob) return toast("دانلود ممکن نشد. دوباره تلاش کن.");
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }, "image/png");
});

// ---------------------------------------------------------------------------
// Debug panel (?debug=1)
// ---------------------------------------------------------------------------

if (state.debugOn) {
  els.debugPanel.classList.remove("hidden");
  for (const key of Object.keys(DEBUG_LAYERS)) {
    const label = document.createElement("label");
    label.className = "flex cursor-pointer items-center gap-1.5 text-[11px] font-medium text-cream/85";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = !!state.debugLayers[key];
    cb.className = "h-3.5 w-3.5 accent-[#D4AF37]";
    cb.addEventListener("change", () => {
      state.debugLayers[key] = cb.checked;
      paintCompare();
    });
    label.appendChild(cb);
    label.appendChild(document.createTextNode(DEBUG_LAYERS[key]));
    els.debugLayersRow.appendChild(label);
  }
}

// ---------------------------------------------------------------------------
// Booking sheet — bottom sheet (mobile) / modal (desktop)
// Never claims confirmation: the request is a ready-to-send draft.
// ---------------------------------------------------------------------------

let bookingDraft = null;

function currentThumb() {
  if (!state.result) return null;
  const c = document.createElement("canvas");
  const max = 132;
  const rc = state.result.canvas;
  const k = Math.min(1, max / rc.width);
  c.width = Math.round(rc.width * k);
  c.height = Math.round(rc.height * k);
  c.getContext("2d").drawImage(rc, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.82);
}

function buildSheet() {
  const root = els.sheetRoot;
  root.innerHTML = `
  <div id="sheetBackdrop" class="sheet-backdrop"></div>
  <div id="sheet" class="sheet" role="dialog" aria-modal="true" aria-label="درخواست هماهنگی">
    <div class="sheet-handle"></div>
    <div id="sheetFormView">
      <p class="text-[11px] font-medium tracking-[0.18em] text-gold-deep">درخواست هماهنگی</p>
      <h3 class="mt-1 text-center text-lg font-extrabold text-brand-800">این مدل رو می‌خوای؟</h3>
      <div id="sheetSummary" class="mt-3 flex items-center gap-3 rounded-2xl bg-cream-100 p-3"></div>
      <form id="sheetForm" class="mt-4 space-y-3">
        <div>
          <label for="sheetName" class="mb-1.5 block text-xs font-medium text-brand-800/70">نام و نام خانوادگی *</label>
          <input id="sheetName" name="name" type="text" required autocomplete="name" class="field w-full rounded-2xl px-4 text-sm" placeholder="مثلاً سارا محمدی" />
        </div>
        <div>
          <label for="sheetPhone" class="mb-1.5 block text-xs font-medium text-brand-800/70">شماره تماس *</label>
          <input id="sheetPhone" name="phone" type="tel" required inputmode="tel" autocomplete="tel" dir="ltr" class="field w-full rounded-2xl px-4 text-left text-sm" placeholder="09xxxxxxxxx" />
        </div>
        <div>
          <label for="sheetNote" class="mb-1.5 block text-xs font-medium text-brand-800/70">توضیح (اختیاری)</label>
          <textarea id="sheetNote" name="note" rows="2" class="field w-full resize-none rounded-2xl px-4 py-3 text-sm" placeholder="مثلاً ابروم ریموو شده و…"></textarea>
        </div>
        <div>
          <label for="sheetTime" class="mb-1.5 block text-xs font-medium text-brand-800/70">زمان دلخواه (اختیاری)</label>
          <input id="sheetTime" name="time" type="text" class="field w-full rounded-2xl px-4 text-sm" placeholder="مثلاً پنجشنبه ساعت ۱۸" />
        </div>
        <button type="submit" class="gold-btn mt-2 flex min-h-[52px] w-full items-center justify-center rounded-2xl text-[15px] font-bold">
          آماده‌سازی درخواست
        </button>
        <button type="button" id="sheetClose" class="w-full text-center text-xs font-medium text-brand-800/55">بستن</button>
      </form>
    </div>
    <div id="sheetSuccessView" class="hidden">
      <p class="text-[11px] font-medium tracking-[0.18em] text-gold-deep">درخواست شما آماده است</p>
      <h3 class="mt-2 text-center text-lg font-extrabold leading-9 text-brand-800">${BOOKING_SUCCESS_TEXT}</h3>
      <p class="mx-auto mt-2 max-w-xs text-center text-sm font-light leading-7 text-brand-800/75">
        ${BOOKING_DISCLAIMER} پیام را از واتساپ یا دایرکت بفرست 👇🏼
      </p>
      <div class="mt-5 space-y-2.5">
        <button id="sheetWa" type="button" class="glass-wa flex min-h-[52px] w-full items-center justify-center rounded-2xl text-[15px] font-bold">ارسال با واتساپ</button>
        <button id="sheetIg" type="button" class="glass-ig flex min-h-[52px] w-full items-center justify-center rounded-2xl text-[14px] font-bold">📸 کپی برای اینستاگرام</button>
        <a id="sheetTel" href="tel:${PHONE_NUMBER}" class="chip flex min-h-[48px] w-full items-center justify-center rounded-2xl text-[13px] font-bold">📞 ${PHONE_NUMBER}</a>
      </div>
      <button id="sheetEdit" type="button" class="mt-4 w-full text-center text-xs font-medium text-brand-800/55">ویرایش اطلاعات</button>
    </div>
  </div>`;

  const backdrop = root.querySelector("#sheetBackdrop");
  const sheet = root.querySelector("#sheet");
  const close = () => {
    sheet.classList.remove("open");
    backdrop.classList.remove("open");
  };
  backdrop.addEventListener("click", close);
  root.querySelector("#sheetClose").addEventListener("click", close);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && sheet.classList.contains("open")) close();
  });

  root.querySelector("#sheetForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = root.querySelector("#sheetName").value.trim();
    const phoneRaw = root.querySelector("#sheetPhone").value.trim();
    const note = root.querySelector("#sheetNote").value.trim();
    const time = root.querySelector("#sheetTime").value.trim();
    if (!name) return toast("لطفاً نامت رو بنویس.");
    const phone = normalizePhone(phoneRaw);
    if (!phone) return toast("شماره تماس معتبر نیست (مثلاً 09121234567).");
    bookingDraft.waUrl = buildWaDraft({
      serviceLabel: SERVICE_LABELS[bookingDraft.service],
      styleLabel: bookingDraft.styleName || "",
      name,
      phone,
      time,
      note,
    });
    bookingDraft.message = decodeURIComponent(bookingDraft.waUrl.split("text=")[1]);
    root.querySelector("#sheetFormView").classList.add("hidden");
    root.querySelector("#sheetSuccessView").classList.remove("hidden");
    root.querySelector("#sheetWa").onclick = () =>
      window.open(bookingDraft.waUrl, "_blank", "noopener,noreferrer");
    root.querySelector("#sheetIg").onclick = async () => {
      const ok = await copyText(bookingDraft.message);
      toast(ok ? "متن کپی شد! در دایرکت پیست کن ✨" : "کپی نشد؛ متن رو دستی کپی کن.");
      window.open(INSTAGRAM_URL, "_blank", "noopener,noreferrer");
    };
  });

  root.querySelector("#sheetEdit").addEventListener("click", () => {
    root.querySelector("#sheetSuccessView").classList.add("hidden");
    root.querySelector("#sheetFormView").classList.remove("hidden");
  });

  return { open: (draft) => { bookingDraft = draft; renderSummary(draft); root.querySelector("#sheetFormView").classList.remove("hidden"); root.querySelector("#sheetSuccessView").classList.add("hidden"); sheet.classList.add("open"); backdrop.classList.add("open"); }, close };
}

function renderSummary(draft) {
  const box = document.getElementById("sheetSummary");
  if (!box) return;
  box.innerHTML = `
    <div class="flex min-w-0 grow flex-col gap-1">
      <span class="text-[13px] font-bold text-brand-800">${SERVICE_LABELS[draft.service]}</span>
      ${draft.styleName ? `<span class="truncate text-[11px] font-light text-brand-800/65">مدل: ${draft.styleName}</span>` : ""}
      <span class="text-[10px] font-light text-brand-800/50">مشهد — برج پاژ · پاسخگویی ۱۰ تا ۲۰</span>
    </div>
    ${draft.thumb ? `<img src="${draft.thumb}" alt="نتیجه" class="h-[64px] w-[64px] shrink-0 rounded-xl object-cover ring-1 ring-brand-800/10" />` : ""}`;
}

async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (_) {
    /* fall through */
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.top = "-999px";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  } catch (_) {
    return false;
  }
}

let sheetApi = null;
function openSheet(opts) {
  if (!sheetApi) sheetApi = buildSheet();
  const style =
    opts.styleId && stylesOf(opts.service).some((s) => s.id === opts.styleId)
      ? stylesOf(opts.service).find((s) => s.id === opts.styleId)
      : null;
  sheetApi.open({
    service: opts.service,
    styleName: style ? style.name : null,
    thumb: opts.thumb !== null ? opts.thumb : currentThumb(),
  });
  document.body.style.overflow = "hidden";
}
function closeSheet() {
  if (sheetApi) sheetApi.close();
  document.body.style.overflow = "";
}

function ctaDraft() {
  return {
    service: state.service,
    styleId: state.styleId,
    thumb: state.result ? currentThumb() : null,
  };
}

els.wantThis.addEventListener("click", () => openSheet(ctaDraft()));
els.sheetBtn.addEventListener("click", () => openSheet(ctaDraft()));

// ---------------------------------------------------------------------------
// Service worker (PWA)
// ---------------------------------------------------------------------------

if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {
      /* offline shell unavailable — page still works */
    });
  });
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

renderStyles();
setHqLabel();
// warm up the model in the background (GPU→CPU fallback inside the wrapper)
analyzer
  .ensure()
  .catch(() => {
    // will surface on first analyze attempt with a proper Persian message
  });
