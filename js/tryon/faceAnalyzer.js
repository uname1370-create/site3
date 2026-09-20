// ---------------------------------------------------------------------------
// faceAnalyzer.js — MediaPipe Face Landmarker (478 pts) wrapper + quality
// gate. Everything runs client-side; the photo never leaves the browser.
// ---------------------------------------------------------------------------

import { buildRegions, scaleRegions } from "./landmarks.js";
import { estimatePose, poseQuality } from "./pose.js";
import { bbox, clamp } from "./lib/vec.js";

export const ANALYZER_URLS = {
  vision: "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.17/+esm",
  wasm: "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.17/wasm",
  model:
    "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
};

export class AnalysisError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.message = message;
  }
}

const MSG = {
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

let modPromise = null;

function loadVisionModule() {
  if (!modPromise) {
    modPromise = import(ANALYZER_URLS.vision).catch((e) => {
      modPromise = null;
      throw new AnalysisError("NO_MODEL", MSG.NO_MODEL);
    });
  }
  return modPromise;
}

export function createFaceAnalyzer(onStatus) {
  let landmarker = null;
  let ready = null;

  async function ensure() {
    if (landmarker) return landmarker;
    if (!ready) {
      ready = (async () => {
        try {
          onStatus && onStatus("model");
          const { FaceLandmarker, FilesetResolver } = await loadVisionModule();
          const vision = await FilesetResolver.forVisionTasks(ANALYZER_URLS.wasm);
          const opts = (delegate) => ({
            baseOptions: { modelAssetPath: ANALYZER_URLS.model, delegate },
            runningMode: "IMAGE",
            numFaces: 3,
          });
          try {
            landmarker = await FaceLandmarker.createFromOptions(vision, opts("GPU"));
          } catch {
            landmarker = await FaceLandmarker.createFromOptions(vision, opts("CPU"));
          }
        } catch (e) {
          ready = null;
          throw e instanceof AnalysisError ? e : new AnalysisError("NO_MODEL", MSG.NO_MODEL);
        }
        onStatus && onStatus("ready");
        return landmarker;
      })();
    }
    return ready;
  }

  /**
   * Analyze an image source (ImageBitmap / HTMLImageElement / canvas).
   * @returns FaceAnalysis (normalized landmarks + pixel regions at NATIVE size)
   */
  async function analyze(source) {
    const lm = await ensure();

    // Detection resolution: cap long edge for speed (landmarks are normalized).
    const natW = source.naturalWidth || source.width;
    const natH = source.naturalHeight || source.height;
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

    let result;
    try {
      result = lm.detect(c);
    } catch (e) {
      throw new AnalysisError("GENERIC", MSG.GENERIC);
    }
    const faces = (result && result.faceLandmarks) || [];
    if (!faces.length) throw new AnalysisError("FACE_NOT_FOUND", MSG.FACE_NOT_FOUND);

    // Pick the largest face; flag when multiple prominent faces exist.
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

    const normalized = faces[bestIdx].map((p) => ({ x: p.x, y: p.y, z: p.z || 0 }));
    const px = normalized.map((p) => ({ x: p.x * natW, y: p.y * natH }));
    const regions = buildRegions(px, { faceWidth: 0 });
    const pose = estimatePose(regions);
    const pQ = poseQuality(pose);

    // Lighting stats over the face region (native-resolution pixels).
    const lighting = measureLighting(source, regions);

    const faceW = regions.faceBounds.w;
    const faceH = regions.faceBounds.h;
    const resolutionOk = faceW >= 300 && faceH >= 340;

    // Feature clipping: the relevant service area must stay inside frame.
    const margin = 14;
    const clip = (b) => b.x < margin || b.y < margin || b.x + b.w > natW - margin || b.y + b.h > natH - margin;
    const features = {
      brow: !clip(bbox(regions.sides[0].browTop.concat(regions.sides[1].browTop))),
      lip: !clip(bbox(regions.lips.outer)),
      liner: !clip(bbox(regions.sides[0].eyeTop.concat(regions.sides[1].eyeTop))),
    };

    const warnings = [];
    const errors = [];
    if (resolutionOk === false)
      errors.push(new AnalysisError("LOW_RESOLUTION", MSG.LOW_RESOLUTION).message);
    if (pQ.blocked.length)
      errors.push(new AnalysisError("EXTREME_POSE", MSG.EXTREME_POSE).message);
    if (pQ.warnings.includes("roll") && !pQ.blocked.includes("roll"))
      warnings.push("صورت کمی کج است؛ نتیجه بهتر روی عکس روبه‌رو است.");
    if (lighting.dark) errors.push(new AnalysisError("LOW_LIGHT", MSG.LOW_LIGHT).message);
    else if (lighting.overexposed)
      errors.push(new AnalysisError("OVEREXPOSED", MSG.OVEREXPOSED).message);
    else if (lighting.flat)
      warnings.push("نور عکس یکنواخت است؛ نتیجه ممکن است کمی خنثی به نظر برسد.");

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
      scaleRegions,
    };
  }

  return { analyze, ensure, release() { try { landmarker && landmarker.close(); } catch { /* noop */ } } };
}

function measureLighting(source, regions) {
  const b = regions.faceBounds;
  const natW = source.naturalWidth || source.width;
  const natH = source.naturalHeight || source.height;
  const sx = clamp(b.x, 0, natW - 2);
  const sy = clamp(b.y, 0, natH - 2);
  const sw = clamp(b.w, 8, natW - sx);
  const sh = clamp(b.h, 8, natH - sy);
  const c = document.createElement("canvas");
  const step = Math.max(1, Math.round(Math.max(sw, sh) / 240));
  c.width = Math.max(2, Math.ceil(sw / step));
  c.height = Math.max(2, Math.ceil(sh / step));
  const g = c.getContext("2d", { willReadFrequently: true });
  g.drawImage(source, sx, sy, sw, sh, 0, 0, c.width, c.height);
  const img = g.getImageData(0, 0, c.width, c.height).data;
  let sum = 0;
  let sum2 = 0;
  let n = 0;
  for (let i = 0; i < img.length; i += 4) {
    const l = 0.2126 * img[i] + 0.7152 * img[i + 1] + 0.0722 * img[i + 2];
    sum += l;
    sum2 += l * l;
    n++;
  }
  const mean = sum / n;
  const std = Math.sqrt(Math.max(0, sum2 / n - mean * mean));
  return {
    mean,
    std,
    dark: mean < 42,
    overexposed: mean > 242,
    flat: std < 9,
  };
}
