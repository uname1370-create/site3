// ---------------------------------------------------------------------------
// tryon.worker.js — runs the expensive CV phases OFF the main thread:
//   { type: "detect" }  ImageBitmap → rasterize → MediaPipe FaceLandmarker →
//                       regions/pose/lighting → full FaceAnalysis (the same
//                       pure core the main-thread fallback uses)
//   { type: "brows"  }  transferred RGBA frame → analyzeBrow() ×2 → geoms
// The browser's native rendering (canvas draw) stays on the main thread.
// ---------------------------------------------------------------------------

import { buildRegions } from "../landmarks.js";
import { analyzeBrow } from "../brow/analyze.js";
import {
  createLandmarker,
  detectOnRaster,
  measureLightingCtx,
  buildAnalysis,
} from "../faceAnalyzer.js";

let lmPromise = null;
function ensureLandmarker() {
  if (!lmPromise) lmPromise = createLandmarker().then((r) => r.landmarker);
  return lmPromise;
}

self.onmessage = async (e) => {
  const m = e.data || {};
  const reply = (data) => self.postMessage({ ok: true, id: m.id, data });
  const fail = (err) => {
    const isAnalysis = err && err.name === "AnalysisError";
    self.postMessage(
      isAnalysis
        ? { ok: false, id: m.id, code: err.code, message: err.message }
        : { ok: false, id: m.id, message: String((err && err.message) || err) }
    );
  };

  try {
    if (m.type === "detect") {
      const landmarker = await ensureLandmarker();
      const natW = m.natW;
      const natH = m.natH;
      const scale = Math.min(1, 1280 / Math.max(natW, natH));
      const dw = Math.max(2, Math.round(natW * scale));
      const dh = Math.max(2, Math.round(natH * scale));
      const oc = new OffscreenCanvas(dw, dh);
      const g = oc.getContext("2d", { willReadFrequently: true });
      g.imageSmoothingEnabled = true;
      g.imageSmoothingQuality = "high";
      g.drawImage(m.bitmap, 0, 0, dw, dh);
      try {
        m.bitmap.close();
      } catch {
        /* already closed by the caller — harmless */
      }

      const { face, prominent } = detectOnRaster(landmarker, oc);
      const normalized = face.map((p) => ({ x: p.x, y: p.y, z: p.z || 0 }));
      const px = normalized.map((p) => ({ x: p.x * natW, y: p.y * natH }));
      const regions = buildRegions(px, { faceWidth: 0 });
      const lighting = measureLightingCtx(g, dw, dh, regions, natW, natH);
      reply(buildAnalysis({ normalized, natW, natH, lighting, prominent }));
    } else if (m.type === "brows") {
      const geoms = m.sides.map((side) =>
        analyzeBrow({ pixels: m.data, width: m.width, height: m.height, side, faceWidth: m.faceWidth })
      );
      reply(geoms);
    } else {
      fail(new Error("unknown worker message type"));
    }
  } catch (err) {
    fail(err);
  }
};
