// ---------------------------------------------------------------------------
// pipeline.js — orchestrates the full deterministic render:
//   photo → resize → landmark regions (scaled) → feature analysis →
//   style fit → masks → texture-preserving pigment → result canvas.
// Two quality tiers: fast preview (≤720px, fewer strokes) and high quality
// (≤1600px). All processing is client-side.
// ---------------------------------------------------------------------------

import { scaleRegions } from "./landmarks.js";
import { analyzeBrow } from "./brow/analyze.js";
import { fitBrow, BROW_STYLES } from "./brow/model.js";
import { renderBrows } from "./brow/render.js";
import { renderLips } from "./lip/render.js";
import { analyzeLiner, LINER_STYLES } from "./liner/analyze.js";
import { renderLiner } from "./liner/render.js";

export const QUALITY = {
  fast: { maxSide: 720, strokeScale: 0.65 },
  high: { maxSide: 1600, strokeScale: 1 },
};

/**
 * @param {object} args
 * @param {ImageBitmap|HTMLImageElement|HTMLCanvasElement} args.source
 * @param {object} args.analysis FaceAnalysis from faceAnalyzer
 * @param {"brow"|"lip"|"liner"} args.service
 * @param {string} args.styleId
 * @param {"fast"|"high"} [args.quality]
 * @param {number} [args.intensity] 0..1 user shade slider
 * @param {function} [args.onStage]
 * @returns {Promise<{canvas, size, debug, meta, timings}>}
 */
export async function renderTryOn({ source, analysis, service, styleId, quality = "fast", intensity = 0.55, onStage }) {
  const t0 = performance.now();
  const q = QUALITY[quality] || QUALITY.fast;
  const natW = source.naturalWidth || source.width;
  const natH = source.naturalHeight || source.height;
  const scale = Math.min(1, q.maxSide / Math.max(natW, natH));
  const W = Math.max(2, Math.round(natW * scale));
  const H = Math.max(2, Math.round(natH * scale));

  onStage && onStage("render");
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, W, H);

  const sx = W / analysis.size.w;
  const sy = H / analysis.size.h;
  const regions = scaleRegions(analysis.regions, sx, sy);
  const debug = {
    service,
    scale: { sx, sy },
    brows: null,
    lips: null,
    liners: null,
    regions,
    landmarksPx: analysis.landmarksPx.map((p) => ({ x: p.x * sx, y: p.y * sy })),
  };

  const frame = ctx.getImageData(0, 0, W, H);

  if (service === "brow") {
    const style = BROW_STYLES[styleId] || BROW_STYLES.micro;
    const sides = [regions.sides[0], regions.sides[1]];
    const geoms = [];
    const fitteds = [];
    for (let i = 0; i < 2; i++) {
      onStage && onStage(`brow-${i}`);
      const geom = analyzeBrow({
        pixels: frame.data,
        width: W,
        height: H,
        side: sides[i],
        faceWidth: regions.faceWidth,
      });
      geoms.push(geom);
      const fitted = fitBrow(style, geom, browSeed(style.id, sides[i].side), q.strokeScale);
      fitteds.push(fitted);
    }
    const skinLuma = meanSkinLuma(frame.data, W, H, regions);
    renderBrows(ctx, fitteds[0], fitteds[1], style, {
      skinLuma,
      intensity,
      fast: quality === "fast",
    });
    debug.brows = { geoms, fitteds, skinLuma };
  } else if (service === "lip") {
    onStage && onStage("lip");
    const { LIP_STYLES } = await import("./styles.js");
    const style = LIP_STYLES[styleId] || LIP_STYLES.nude;
    renderLips(ctx, regions, style, clamp01(intensity));
    debug.lips = { styleId };
  } else if (service === "liner") {
    const { LINER_STYLE_MAP } = await import("./styles.js");
    const styleId2 = LINER_STYLE_MAP[styleId] || styleId;
    const style = LINER_STYLES[styleId2] || LINER_STYLES.classic;
    onStage && onStage("liner");
    const fitteds = regions.sides.map((s, i) => {
      onStage && onStage(`liner-${i}`);
      return analyzeLiner(s, style, 44, regions.noseTip.x);
    });
    for (const f of fitteds) renderLiner(ctx, f, clamp01(intensity));
    debug.liners = { fitteds, styleId: styleId2 };
  } else {
    throw new Error(`unknown service: ${service}`);
  }

  const timings = { totalMs: Math.round(performance.now() - t0) };
  return { canvas, size: { w: W, h: H }, debug, meta: { quality, service, styleId }, timings };
}

function browSeed(styleId, side) {
  let h = 2166136261;
  const s = `${styleId}|${side}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Mean luminance of the brow zone (for pigment lighting adaptation). */
function meanSkinLuma(data, W, H, regions) {
  const s = regions.sides[0];
  const t = regions.sides[1];
  let sum = 0;
  let n = 0;
  const sample = (side) => {
    const c = side.eyeCenter;
    const w = Math.max(20, side.eyeWidth * 0.8);
    const y0 = Math.round(c.y - side.eyeWidth * 0.55);
    for (let y = y0; y < y0 + 6; y++) {
      for (let x = Math.round(c.x - w / 2); x < c.x + w / 2; x += 3) {
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const j = (y * W + x) * 4;
        sum += 0.2126 * data[j] + 0.7152 * data[j + 1] + 0.0722 * data[j + 2];
        n++;
      }
    }
  };
  sample(s);
  sample(t);
  return n ? sum / n : 150;
}

function clamp01(v) {
  return Math.max(0.15, Math.min(1, v));
}
