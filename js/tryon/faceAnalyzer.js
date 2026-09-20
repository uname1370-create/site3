// ---------------------------------------------------------------------------
// faceAnalyzer.js — MediaPipe Face Landmarker (478 pts) wrapper + quality
// gates. Everything runs client-side; the photo never leaves the browser.
//
// Architecture:
//   - the pure core (detect on a raster, lighting stats, gate/analysis build)
//     is shared between the main thread and the Web Worker, and unit-testable
//     in Node;
//   - when Worker + OffscreenCanvas + createImageBitmap are available,
//     detection runs in tryon.worker.js (UI stays fluid); any worker
//     failure transparently falls back to the inline path.
//   - assets: a self-hosted ./vendor/mediapipe copy is used when present
//     (tools/fetch-vendor.mjs), otherwise the CDN.
// ---------------------------------------------------------------------------

import { buildRegions, scaleRegions } from "./landmarks.js";
import { estimatePose, poseQuality } from "./pose.js";
import { bbox, clamp } from "./lib/vec.js";
import { workerAvailable, postWorker } from "./workers/client.js";

export const CDN_URLS = {
  vision: "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.17/+esm",
  wasm: "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.17/wasm",
  model:
    "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
};

// Self-hosted copy (relative to the SITE root, resolved from this module's
// URL so it works in the worker too).
export const VENDOR_URLS = {
  vision: new URL("../../vendor/mediapipe/vision_bundle.mjs", import.meta.url).href,
  wasm: new URL("../../vendor/mediapipe/wasm/", import.meta.url).href,
  model: new URL("../../vendor/mediapipe/face_landmarker.task", import.meta.url).href,
};

/** Use the local vendor copy when the model file is served, else CDN. */
export async function resolveAssetUrls() {
  try {
    const r = await fetch(VENDOR_URLS.model, { method: "HEAD" });
    if (r.ok) return { ...VENDOR_URLS, local: true };
  } catch {
    /* not served → CDN */
  }
  return { ...CDN_URLS, local: false };
}

export class AnalysisError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "AnalysisError";
    this.code = code;
    this.message = message;
  }
}

export const MSG = {
  FACE_NOT_FOUND: "چهره‌ای در عکس پیدا نشد. یک عکس واضح و روبه‌رو انتخاب کن.",
  MULTIPLE_FACES: "چند چهره در عکس هست. لطفاً یک عکس تک‌چهره انتخاب کن.",
  LOW_RESOLUTION: "عکس خیلی رزولوشن پایینی دارد. یک عکس بزرگ‌تر انتخاب کن.",
  EXTREME_POSE: "زاویه عکس خیلی تند است. یک عکس روبه‌رو با نور مناسب انتخاب کن.",
  LOW_LIGHT: "نور عکس خیلی کم است. یک عکس روشن‌تر انتخاب کن.",
  OVEREXPOSED: "عکس خیلی پرنور است. شاتیر یا عکسی با نور ملایم انتخاب کن.",
  FLAT_LIGHT: "نور عکس خیلی یکنواخت است. عکسی با کمی سایه طبیعی بهتر است.",
  FEATURES_CLIPPED: "قسمت مورد نظر عکس قطع شده. کمی عقب‌تر یا کامل‌تر عکس بگیر.",
  NO_MODEL: "موتور پردازش لود نشد. اتصال اینترنت را بررسی کن و دوباره تلاش کن.",
  GENERIC: "خطا در پردازش عکس. دوباره تلاش کن.",
};

// ---------------------------------------------------------------------------
// Pure core — shared by main thread, worker, and Node tests.
// ---------------------------------------------------------------------------

/**
 * Run the landmarker on a raster (HTMLCanvasElement or OffscreenCanvas).
 * @returns {{face: Array<{x,y,z}>, prominent: number}} normalized points of
 *   the largest face + number of prominent faces (>8% of frame area).
 */
export function detectOnRaster(landmarker, raster) {
  let result;
  try {
    result = landmarker.detect(raster);
  } catch {
    throw new AnalysisError("GENERIC", MSG.GENERIC);
  }
  const faces = (result && result.faceLandmarks) || [];
  if (!faces.length) throw new AnalysisError("FACE_NOT_FOUND", MSG.FACE_NOT_FOUND);

  const dw = raster.width;
  const dh = raster.height;
  let bestIdx = 0;
  let bestArea = 0;
  let prominent = 0;
  for (let i = 0; i < faces.length; i++) {
    const b = bbox(faces[i].map((p) => ({ x: p.x * dw, y: p.y * dh })));
    const area = b.w * b.h;
    if (area > bestArea) {
      bestArea = area;
      bestIdx = i;
    }
    if (area > dw * dh * 0.08) prominent++;
  }
  if (prominent > 1) throw new AnalysisError("MULTIPLE_FACES", MSG.MULTIPLE_FACES);
  return { face: faces[bestIdx], prominent };
}

/**
 * Luminance stats of the face region from a 2d context.
 * @param {CanvasRenderingContext2D|OffscreenCanvasRenderingContext2D} g
 * @param {number} dw raster width (must match `regions` scale: pass raster
 *   size + native size so the face bounds are mapped correctly)
 */
export function measureLightingCtx(g, dw, dh, regions, natW, natH) {
  const kx = dw / natW;
  const ky = dh / natH;
  const b = regions.faceBounds;
  const X = Math.max(0, Math.min(dw - 2, Math.round(b.x * kx)));
  const Y = Math.max(0, Math.min(dh - 2, Math.round(b.y * ky)));
  const Wd = Math.max(8, Math.min(dw - X, Math.round(b.w * kx)));
  const Hd = Math.max(8, Math.min(dh - Y, Math.round(b.h * ky)));
  const img = g.getImageData(X, Y, Wd, Hd);
  const d = img.data;
  const step = Math.max(1, Math.round(Math.max(Wd, Hd) / 240));
  let sum = 0;
  let sum2 = 0;
  let n = 0;
  for (let y = 0; y < img.height; y += step) {
    for (let x = 0; x < img.width; x += step) {
      const j = (y * img.width + x) * 4;
      const l = 0.2126 * d[j] + 0.7152 * d[j + 1] + 0.0722 * d[j + 2];
      sum += l;
      sum2 += l * l;
      n++;
    }
  }
  const mean = sum / n;
  const std = Math.sqrt(Math.max(0, sum2 / n - mean * mean));
  return { mean, std, dark: mean < 42, overexposed: mean > 242, flat: std < 9 };
}

/**
 * Build the full FaceAnalysis: pixel landmarks, regions, pose, and the
 * quality gate (resolution / pose / lighting / feature clipping).
 * Pure — no DOM, no network. Used by the worker and the inline path alike.
 */
export function buildAnalysis({ normalized, natW, natH, lighting, prominent = 1 }) {
  const px = normalized.map((p) => ({ x: p.x * natW, y: p.y * natH }));
  const regions = buildRegions(px, { faceWidth: 0 });
  const pose = estimatePose(regions);
  const pQ = poseQuality(pose);

  const faceW = regions.faceBounds.w;
  const faceH = regions.faceBounds.h;
  const resolutionOk = faceW >= 300 && faceH >= 340;

  const margin = 14;
  const clip = (b) => b.x < margin || b.y < margin || b.x + b.w > natW - margin || b.y + b.h > natH - margin;
  const features = {
    brow: !clip(bbox(regions.sides[0].browTop.concat(regions.sides[1].browTop))),
    lip: !clip(bbox(regions.lips.outer)),
    liner: !clip(bbox(regions.sides[0].eyeTop.concat(regions.sides[1].eyeTop))),
  };

  const warnings = [];
  const errors = [];
  if (!resolutionOk) errors.push(MSG.LOW_RESOLUTION);
  if (pQ.blocked.length) errors.push(MSG.EXTREME_POSE);
  if (pQ.warnings.includes("roll") && !pQ.blocked.includes("roll"))
    warnings.push("صورت کمی کج است؛ نتیجه بهتر روی عکس روبه‌رو است.");
  if (lighting.dark) errors.push(MSG.LOW_LIGHT);
  else if (lighting.overexposed) errors.push(MSG.OVEREXPOSED);
  else if (lighting.flat) warnings.push("نور عکس یکنواخت است؛ نتیجه ممکن است کمی خنثی به نظر برسد.");

  return {
    landmarks: normalized,
    landmarksPx: px,
    regions,
    pose,
    size: { w: natW, h: natH },
    quality: {
      faceDetected: true,
      singleFace: prominent <= 1,
      sufficientResolution: resolutionOk,
      acceptablePose: pQ.acceptable,
      acceptableLighting: !lighting.dark && !lighting.overexposed,
      lighting,
      features,
    },
    warnings: [...new Set(warnings)],
    errors: [...new Set(errors)],
  };
}

// ---------------------------------------------------------------------------
// MediaPipe module + landmarker (shared by main thread and worker)
// ---------------------------------------------------------------------------

const modCache = new Map();
export function loadVisionModule(urls) {
  if (!modCache.has(urls.vision)) {
    modCache.set(
      urls.vision,
      import(urls.vision).catch((e) => {
        modCache.delete(urls.vision);
        throw new AnalysisError("NO_MODEL", MSG.NO_MODEL);
      })
    );
  }
  return modCache.get(urls.vision);
}

export async function createLandmarker(onStatus) {
  const urls = await resolveAssetUrls();
  onStatus && onStatus("model");
  const { FaceLandmarker, FilesetResolver } = await loadVisionModule(urls);
  const vision = await FilesetResolver.forVisionTasks(urls.wasm);
  const opts = (delegate) => ({
    baseOptions: { modelAssetPath: urls.model, delegate },
    runningMode: "IMAGE",
    numFaces: 3,
  });
  let landmarker;
  try {
    landmarker = await FaceLandmarker.createFromOptions(vision, opts("GPU"));
  } catch {
    landmarker = await FaceLandmarker.createFromOptions(vision, opts("CPU"));
  }
  onStatus && onStatus("ready");
  return { landmarker, urls };
}

// ---------------------------------------------------------------------------
// Public analyzer
// ---------------------------------------------------------------------------

export function createFaceAnalyzer(onStatus) {
  let lm = null;
  let ready = null;

  async function ensure() {
    if (lm) return lm;
    if (!ready) {
      ready = createLandmarker(onStatus)
        .then((r) => {
          lm = r.landmarker;
          return lm;
        })
        .catch((e) => {
          ready = null;
          throw e instanceof AnalysisError ? e : new AnalysisError("NO_MODEL", MSG.NO_MODEL);
        });
    }
    return ready;
  }

  /**
   * Analyze an image source (ImageBitmap / HTMLImageElement / canvas).
   * @returns FaceAnalysis (normalized landmarks + pixel regions at NATIVE size)
   */
  async function analyze(source) {
    const natW = source.naturalWidth || source.width;
    const natH = source.naturalHeight || source.height;

    // --- Worker path (detection off the main thread) ----------------------
    if (workerAvailable()) {
      let bitmap = null;
      try {
        bitmap = await createImageBitmap(source);
        const a = await postWorker({ type: "detect", bitmap, natW, natH }, [bitmap], 45000);
        a.scaleRegions = scaleRegions;
        return a;
      } catch (e) {
        if (e && e.code) throw new AnalysisError(e.code, e.message); // real detection gate → keep the Persian message
        console.warn("[tryon] worker detect failed → inline fallback:", e.message);
      } finally {
        try {
          bitmap && bitmap.close();
        } catch {
          /* noop */
        }
      }
    }

    // --- Inline fallback (always works, older Safari included) ------------
    const landmarker = await ensure();
    onStatus && onStatus("detect");
    const scale = Math.min(1, 1280 / Math.max(natW, natH));
    const dw = Math.max(2, Math.round(natW * scale));
    const dh = Math.max(2, Math.round(natH * scale));
    const c = document.createElement("canvas");
    c.width = dw;
    c.height = dh;
    const g = c.getContext("2d", { willReadFrequently: true });
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = "high";
    g.drawImage(source, 0, 0, dw, dh);

    const { face, prominent } = detectOnRaster(landmarker, c);
    const normalized = face.map((p) => ({ x: p.x, y: p.y, z: p.z || 0 }));
    const px = normalized.map((p) => ({ x: p.x * natW, y: p.y * natH }));
    const regions = buildRegions(px, { faceWidth: 0 });
    const lighting = measureLightingCtx(g, dw, dh, regions, natW, natH);
    return buildAnalysis({ normalized, natW, natH, lighting, prominent });
  }

  return {
    analyze,
    ensure,
    release() {
      try {
        lm && lm.close();
      } catch {
        /* noop */
      }
    },
  };
}
