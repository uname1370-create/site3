// ---------------------------------------------------------------------------
// brow/render.js — renders fitted brows onto the result frame.
//
// Two composable passes per brow:
//  1) SDF base: per-pixel gaussian falloff around the TARGET centerline with
//     a style gradient (head→tail). This is the "precise mask" — soft,
//     resolution-independent, never a hard polygon.
//  2) Hair strokes: tapered quadratic strokes supersampled 2× on a small
//     local canvas (no ctx.filter — Safari-safe), composited down.
// Blending: `multiply` (pigment over skin, texture preserved) + `soft-light`
// (warmth/depth). Lighting adaptation scales pigment strength with the
// measured local skin luminance so the result follows the photo's light.
// ---------------------------------------------------------------------------

import { hexToRgb } from "../lib/lab.js";
import { bbox, clamp, nearestOnPolyline } from "../lib/vec.js";

/**
 * @param {CanvasRenderingContext2D} ctx destination (result frame)
 * @param {object} fittedL fitted brow for image-left side
 * @param {object} fittedR fitted brow for image-right side
 * @param {object} style  BROW_STYLES entry
 * @param {object} opts { skinLuma (0..255 mean of brow zone), intensity (0..1 user shade), fast }
 */
export function renderBrows(ctx, fittedL, fittedR, style, opts) {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const [r, g, b] = hexToRgb(style.colorProfile.base);

  // Lighting adaptation: bright skin carries slightly darker (stronger)
  // pigment, deep skin gets a lighter, softer one.
  const skinL = opts.skinLuma ?? 150;
  const lightF = clamp(1.15 - skinL / 700, 0.8, 1.1);
  const pr = clamp(r * lightF, 0, 255);
  const pg = clamp(g * lightF, 0, 255);
  const pb = clamp(b * lightF, 0, 255);
  const alphaScale = clamp(opts.intensity ?? 0.55, 0.2, 1) * (skinL < 90 ? 0.85 : skinL > 200 ? 0.95 : 1);

  for (const fitted of [fittedL, fittedR]) {
    if (!fitted) continue;
    renderPowderBase(ctx, W, H, fitted, { r: pr, g: pg, b: pb }, alphaScale, style, opts);
    renderStrokes(ctx, W, H, fitted, { r: pr, g: pg, b: pb }, alphaScale, opts);
  }
}

// ---------------------------------------------------------------------------

function localCanvas(W, H, x0, y0, w, h, ss) {
  const c = document.createElement("canvas");
  c.width = Math.max(2, Math.ceil(w * ss));
  c.height = Math.max(2, Math.ceil(h * ss));
  const g = c.getContext("2d");
  g.setTransform(ss, 0, 0, ss, 0, 0);
  return { c, g, x0, y0, w, h, ss };
}

function composite(ctx, c, x0, y0, w, h, mode, alpha) {
  if (alpha <= 0.004) return;
  ctx.save();
  ctx.globalCompositeOperation = mode;
  ctx.globalAlpha = clamp(alpha, 0, 0.96);
  ctx.drawImage(c, x0, y0, w, h);
  ctx.restore();
}

/** Soft gaussian mask value at pixel for the SDF base. */
function sdfAlpha(px, py, fitted, widthMul) {
  const near = nearestOnPolyline({ x: px, y: py }, fitted.centerline);
  const n = fitted.centerline.length - 1;
  const u = clamp((near.i + near.t) / n, 0, 1);
  const hw = fitted.halfWidth[clamp(Math.round(u * n), 0, n)] * widthMul;
  const d = near.d / Math.max(0.8, hw);
  return Math.exp(-1.35 * d * d);
}

function renderPowderBase(ctx, W, H, fitted, color, alphaScale, style, opts) {
  const p = fitted.powder;
  if (!p || p.gain <= 0) return;
  const bb = bbox(fitted.centerline);
  const margin = Math.max(10, bb.h * 0.8);
  const x0 = Math.max(0, bb.x - margin);
  const y0 = Math.max(0, bb.y - margin);
  const w = Math.min(W - x0, bb.w + margin * 2);
  const h = Math.min(H - y0, bb.h + margin * 2);
  if (w < 4 || h < 4) return;

  const { c, g, ss } = localCanvas(W, H, x0, y0, w, h, 1);
  const img = g.createImageData(Math.ceil(w), Math.ceil(h));
  const data = img.data;
  const n = fitted.centerline.length - 1;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = sdfAlpha(x0 + x, y0 + y, fitted, p.width);
      if (a < 0.02) continue;
      // head→tail gradient (ombre): light head, dense tail
      const near = nearestOnPolyline({ x: x0 + x, y: y0 + y }, fitted.centerline);
      const u = clamp((near.i + near.t) / n, 0, 1);
      const grad = p.head + (p.tail - p.head) * smoothstep(0.1, 0.7, u);
      const alpha = a * p.gain * grad * alphaScale;
      const j = (y * Math.ceil(w) + x) * 4;
      data[j] = color.r;
      data[j + 1] = color.g;
      data[j + 2] = color.b;
      data[j + 3] = Math.round(clamp(alpha, 0, 0.95) * 255);
    }
  }
  g.putImageData(img, 0, 0);

  composite(ctx, c, x0, y0, w, h, "multiply", 0.9);
  composite(ctx, c, x0, y0, w, h, "soft-light", 0.28);
}

/** Faint wide "shadow" pass under powder brows (depth, still soft). */
function smoothstep(a, b, x) {
  const t = clamp((x - a) / (b - a || 1), 0, 1);
  return t * t * (3 - 2 * t);
}

function renderStrokes(ctx, W, H, fitted, color, alphaScale, opts) {
  const strokes = fitted.strokes;
  if (!strokes.length) return;
  const bb = bbox(fitted.centerline);
  const m = Math.max(8, bb.h * 0.5);
  const x0 = Math.max(0, bb.x - m);
  const y0 = Math.max(0, bb.y - m);
  const w = Math.min(W - x0, bb.w + m * 2);
  const h = Math.min(H - y0, bb.h + m * 2);
  if (w < 4 || h < 4) return;

  const ss = opts.fast ? 1.5 : 2;
  const { c, g } = localCanvas(W, H, x0, y0, w, h, ss);
  g.clearRect(0, 0, w, h);
  g.strokeStyle = `rgb(${color.r | 0},${color.g | 0},${color.b | 0})`;
  g.lineCap = "round";
  g.lineJoin = "round";

  for (const s of strokes) {
    if (s.x0 < x0 - 4 || s.x0 > x0 + w + 4 || s.y0 < y0 - 4 || s.y0 > y0 + h + 4) continue;
    // tapered quadratic: sample and draw segments with varying width
    const steps = 8;
    let prev = quadPoint(s, 0);
    for (let k = 1; k <= steps; k++) {
      const t = k / steps;
      const p = quadPoint(s, t);
      g.globalAlpha = clamp(s.op * alphaScale * (0.55 + 0.45 * t), 0, 0.95);
      g.lineWidth = Math.max(0.35, s.w * (0.4 + 0.6 * Math.sin(Math.PI * clamp(t, 0, 1)) * 0.8 + 0.2));
      g.beginPath();
      g.moveTo(prev.x, prev.y);
      g.lineTo(p.x, p.y);
      g.stroke();
      prev = p;
    }
  }
  g.globalAlpha = 1;

  // Downscale compositing doubles as the antialias/soften pass (Safari-safe).
  const targetAlpha = opts.fast ? 0.8 : 1;
  composite(ctx, c, x0, y0, w, h, "multiply", 0.62 * targetAlpha);
  composite(ctx, c, x0, y0, w, h, "soft-light", 0.14 * targetAlpha);
}

function quadPoint(s, t) {
  const mt = 1 - t;
  return {
    x: mt * mt * s.x0 + 2 * mt * t * s.cx + t * t * s.x1,
    y: mt * mt * s.y0 + 2 * mt * t * s.cy + t * t * s.y1,
  };
}
