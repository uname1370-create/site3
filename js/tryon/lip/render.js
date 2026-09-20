// ---------------------------------------------------------------------------
// lip/render.js — builds the lip masks (outer − inner mouth, feathered,
// edge band) and applies the LAB colorization on the result frame.
// Masks come from the detected landmark polygons — resolution-independent,
// never a fixed shape. Inner mouth and teeth are cut out (destination-out).
// ---------------------------------------------------------------------------

import { smoothClosedPoly, tracePath } from "../lib/canvasPath.js";
import { colorizeLips } from "./colorize.js";
import { rgb2lab } from "../lib/lab.js";
import { clamp } from "../lib/vec.js";

/**
 * @param {CanvasRenderingContext2D} ctx result frame (already = original photo)
 * @param {object} regions pixel-space regions (frame coordinates)
 * @param {object} style  { color: hex, finish: 'satin'|'matte', alpha }
 * @param {number} strength user shade 0..1
 */
export function renderLips(ctx, regions, style, strength) {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const outer = regions.lips.outer;
  const inner = regions.lips.inner;

  const maskCanvas = maskOf(outer, inner, W, H);
  const bandCanvas = bandOf(outer, W, H, outer.length);

  // ROI
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of outer) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const pad = 10;
  const x0 = clamp(Math.floor(minX - pad), 0, W - 1);
  const y0 = clamp(Math.floor(minY - pad), 0, H - 1);
  const w = clamp(Math.ceil(maxX + pad - x0), 8, W - x0);
  const h = clamp(Math.ceil(maxY + pad - y0), 8, H - y0);

  const src = ctx.getImageData(x0, y0, w, h);
  const mCtx = maskCanvas.getContext("2d");
  const bCtx = bandCanvas.getContext("2d");
  const mImg = mCtx.getImageData(x0, y0, w, h);
  const bImg = bCtx.getImageData(x0, y0, w, h);

  const maskF = new Float32Array(w * h);
  const bandF = new Float32Array(w * h);
  let sum = 0;
  let sumN = 0;
  let maxD = 0;
  const c = regions.lips.center;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const j = i * 4;
      maskF[i] = mImg.data[j + 3] / 255;
      bandF[i] = bImg.data[j + 3] / 255;
      if (maskF[i] > 0.35) {
        const j2 = i * 4;
        sum += 0.2126 * src.data[j2] + 0.7152 * src.data[j2 + 1] + 0.0722 * src.data[j2 + 2];
        sumN++;
        const d = Math.hypot(x + x0 - c.x, y + y0 - c.y);
        if (d > maxD) maxD = d;
      }
    }
  }
  const Lmean = sumN ? sum / sumN : 128;
  const [pr, pg, pb] = hexToRgbArr(style.color);
  const pigment = rgb2lab(pr, pg, pb);
  // keep pigment lightness inside a natural shading band
  pigment[0] = clamp(pigment[0], 38, 78);

  colorizeLips(src.data, w, h, maskF, bandF, {
    pigment,
    Lmean,
    center: { x: c.x - x0, y: c.y - y0 },
    dmax: Math.max(8, maxD),
    strength,
    keepContrast: style.finish === "matte" ? 0.78 : 0.88,
  });

  ctx.putImageData(src, x0, y0);
}

// ---------------------------------------------------------------------------

function hexToRgbArr(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [150, 90, 80];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** outer polygon filled white, inner polygon cut out, feathered. */
function maskOf(outer, inner, W, H) {
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d");
  g.clearRect(0, 0, W, H);
  g.fillStyle = "#fff";
  tracePath(g, outer, true);
  g.fill();
  g.globalCompositeOperation = "destination-out";
  tracePath(g, inner, true);
  g.fill();
  g.globalCompositeOperation = "source-over";
  feather(g, c, W, H);
  return c;
}

/** Rim band: outer boundary stroked + feathered → "linelike" edge. */
function bandOf(outer, W, H) {
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d");
  g.clearRect(0, 0, W, H);
  const bb = bboxPoly(outer);
  const bandW = clamp(Math.hypot(bb.w, bb.h) * 0.055, 2, 9);
  g.strokeStyle = "#fff";
  g.lineWidth = bandW;
  g.lineJoin = "round";
  tracePath(g, outer, true);
  g.stroke();
  feather(g, c, W, H);
  return c;
}

function bboxPoly(pts) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/**
 * Downscale→upscale = cheap bilinear blur (Safari-safe; no ctx.filter).
 * Applied in-place on the canvas.
 */
function feather(g, c, W, H) {
  const tmp = document.createElement("canvas");
  tmp.width = Math.max(1, Math.ceil(W / 2));
  tmp.height = Math.max(1, Math.ceil(H / 2));
  const tg = tmp.getContext("2d");
  tg.drawImage(c, 0, 0, tmp.width, tmp.height);
  g.clearRect(0, 0, W, H);
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = "high";
  g.drawImage(tmp, 0, 0, W, H);
}
