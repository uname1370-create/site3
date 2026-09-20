// ---------------------------------------------------------------------------
// brow/analyze.js — detects the user's REAL eyebrow from image pixels inside
// the landmark-bounded ROI, and produces a geometric brow frame:
//   centerline C(u), tangents, normals, half-width profile, hair density.
//
// Pipeline: luminance → per-column skin median (robust: band < 50% of the
// column) → darkness profile → per-column Otsu → contiguous band around the
// darkest run → morphology (open) → per-column projection → smoothed
// arc-length-parameterized frame.
// Falls back to a landmark-derived frame when no hair signal is found.
//
// Pure module: takes a pixel buffer, returns geometry. Testable in Node.
// ---------------------------------------------------------------------------

import { open, polygonMask, percentile } from "../lib/image.js";
import {
  chaikin,
  resamplePolyline,
  tangentAt,
  rot90,
  v2,
  add,
  scale,
  dist,
  polylineLength,
  clamp,
} from "../lib/vec.js";

const FRAME_N = 48;

/**
 * @param {object} args
 * @param {Uint8ClampedArray} args.pixels RGBA of the full render frame
 * @param {number} args.width, args.height
 * @param {object} args.side  one entry of regions.sides (pixel space of frame)
 * @param {number} args.faceWidth
 * @param {number} [args.minFaceWidth] sanity scale
 */
export function analyzeBrow({ pixels, width, height, side, faceWidth }) {
  const roi = side.browROI;
  // ROI bbox with padding
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of roi) {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
  }
  const pad = Math.max(6, faceWidth * 0.04);
  minX = Math.max(0, Math.floor(minX - pad));
  minY = Math.max(0, Math.floor(minY - pad));
  maxX = Math.min(width - 1, Math.ceil(maxX + pad));
  maxY = Math.min(height - 1, Math.ceil(maxY + pad));
  const rw = maxX - minX + 1;
  const rh = maxY - minY + 1;
  if (rw < 8 || rh < 8) return landmarksFallback(side, faceWidth);

  // Luminance window
  const L = new Float32Array(rw * rh);
  for (let y = 0; y < rh; y++) {
    const gy = y + minY;
    for (let x = 0; x < rw; x++) {
      const gx = x + minX;
      const j = (gy * width + gx) * 4;
      L[y * rw + x] = 0.2126 * pixels[j] + 0.7152 * pixels[j + 1] + 0.0722 * pixels[j + 2];
    }
  }

  const roiMaskLocal = polygonMask(roi.map((p) => v2(p.x - minX, p.y - minY)), rw, rh);

  // Per-column band detection.
  // The brow band occupies well under half of the ROI column height, so the
  // column MEDIAN is a robust skin estimate — even under the band itself.
  // darkness = median - L is bimodal (skin ≈ 0, brow ≥ 20) → per-column Otsu
  // finds the full band, and we keep only the contiguous run around the
  // darkest point (rejects stray dark lines such as the lash line).
  const colCount = new Int32Array(rw);
  const colMinY = new Float32Array(rw).fill(rh);
  const colMaxY = new Float32Array(rw).fill(-1);
  const sumY = new Float32Array(rw);
  let hair = new Uint8Array(rw * rh);
  let hairCount = 0;

  const noiseFloor = 9; // darker than this vs local skin = not a brow (per channel noise ~ ±4)
  for (let x = 0; x < rw; x++) {
    // gather masked ys for this column
    const ys = [];
    for (let y = 0; y < rh; y++) {
      if (roiMaskLocal[y * rw + x]) ys.push(y);
    }
    if (ys.length < 12) continue;
    const vals = ys.map((y) => L[y * rw + x]);
    const med = percentile(vals, 0.5);
    const dark = new Float32Array(ys.length);
    let maxDark = 0;
    let argmax = -1;
    for (let k = 0; k < ys.length; k++) {
      dark[k] = med - vals[k];
      if (dark[k] > maxDark) {
        maxDark = dark[k];
        argmax = k;
      }
    }
    if (maxDark < noiseFloor) continue;
    // Gap-based threshold: walk up the sorted darkness from the skin mode
    // while consecutive values are close; the threshold is the mid-gap
    // between the skin cluster and the (ramp-like) band cluster.
    // (Plain Otsu is unreliable here — its optimum plateau runs up into the
    // band's own value range.)
    const sorted = Array.from(dark).sort((a, b) => a - b);
    const step = Math.max(3, maxDark * 0.12);
    let skinTop = sorted[0];
    let bandBottom = -1;
    for (let k = 1; k < sorted.length; k++) {
      if (sorted[k] - sorted[k - 1] <= step) {
        skinTop = sorted[k];
      } else {
        bandBottom = sorted[k];
        break;
      }
    }
    const thresh =
      bandBottom > 0
        ? clamp((skinTop + bandBottom) / 2, maxDark * 0.15, maxDark * 0.7)
        : maxDark * 0.3;
    // contiguous run around the darkest point
    if (argmax < 0) continue;
    let a = argmax;
    while (a > 0 && dark[a - 1] > thresh) a--;
    let b = argmax;
    while (b < ys.length - 1 && dark[b + 1] > thresh) b++;
    const count = b - a + 1;
    if (count < 2 || count > ys.length * 0.6) continue;
    let sy = 0;
    for (let k = a; k <= b; k++) {
      hair[ys[k] * rw + x] = 1;
      hairCount++;
      sy += ys[k];
    }
    colCount[x] = count;
    colMinY[x] = ys[a];
    colMaxY[x] = ys[b];
    sumY[x] = sy;
  }

  if (hairCount < Math.max(24, rw * rh * 0.004)) return landmarksFallback(side, faceWidth);

  hair = open(hair, rw, rh, 1);

  // Per-column statistics over the opened mask.
  colCount.fill(0);
  colMinY.fill(rh);
  colMaxY.fill(-1);
  sumY.fill(0);
  for (let y = 0; y < rh; y++) {
    for (let x = 0; x < rw; x++) {
      const i = y * rw + x;
      if (hair[i]) {
        colCount[x]++;
        if (y < colMinY[x]) colMinY[x] = y;
        if (y > colMaxY[x]) colMaxY[x] = y;
        sumY[x] += y;
      }
    }
  }

  // Weighted mean y per column
  const meanY = new Float32Array(rw).fill(-1);
  for (let x = 0; x < rw; x++) {
    if (colCount[x] > 0) meanY[x] = sumY[x] / colCount[x];
  }

  // Half-width per column (band is symmetric about its midline by
  // construction of the contiguous run).
  const halfW = new Float32Array(rw);
  for (let x = 0; x < rw; x++) {
    if (colCount[x] >= 3) {
      halfW[x] = (colMaxY[x] - colMinY[x]) * 0.5;
    } else if (colCount[x] > 0) {
      halfW[x] = Math.max(1, colCount[x] * 0.8);
    }
  }

  // Build the raw centerline from columns with hair.
  const raw = [];
  let span = 0;
  for (let x = 0; x < rw; x++) {
    if (meanY[x] >= 0 && colCount[x] >= 1) {
      raw.push(v2(minX + x, minY + meanY[x]));
      span++;
    }
  }
  if (span < Math.max(10, rw * 0.25)) return landmarksFallback(side, faceWidth);

  // Smooth, then re-parameterize back to exactly FRAME_N arc-length points.
  let center = resamplePolyline(raw, FRAME_N * 2);
  center = chaikin(center, 2);
  center = movingAvg(center, 3);
  center = resamplePolyline(center, FRAME_N);

  const frame = buildFrame(center, side, faceWidth);
  if (!frame) return landmarksFallback(side, faceWidth);

  // Half-width profile sampled onto the frame.
  const hw = new Float32Array(FRAME_N);
  const dens = new Float32Array(FRAME_N);
  for (let i = 0; i < FRAME_N; i++) {
    const p = center[i];
    const gx = clamp(Math.round(p.x - minX), 0, rw - 1);
    hw[i] = halfW[gx] > 0 ? halfW[gx] : 2;
    const c = colCount[gx];
    const spread = Math.max(1, halfW[gx] * 2);
    dens[i] = clamp(c / (spread * 1.4), 0, 1);
  }
  smoothArray(hw);
  smoothArray(dens);
  const hwMin = Math.max(1.1, faceWidth * 0.004);
  const hwMax = Math.max(hwMin + 1, faceWidth * 0.05);
  for (let i = 0; i < FRAME_N; i++) hw[i] = clamp(hw[i], hwMin, hwMax);

  const peak = center.reduce((best, p, i) => (p.y < center[best].y ? i : best), 0);
  const start = center[0];
  const tail = center[FRAME_N - 1];
  const browLen = polylineLength(center);
  const tailRef = center[Math.floor(FRAME_N * 0.85)];
  const tailAngle = (Math.atan2(tail.y - tailRef.y, Math.abs(tail.x - tailRef.x)) * 180) / Math.PI;

  return {
    ok: true,
    method: "pixels",
    centerline: center,
    tangents: frame.tangents,
    normals: frame.normals,
    halfWidth: hw,
    density: dens,
    start,
    tail,
    peak: center[peak],
    peakIndex: peak,
    browLen,
    tailAngle,
    eyeCenterX: side.eyeCenter.x,
    eyeCenterY: side.eyeCenter.y,
    roi: side.browROI,
    side: side.side,
  };
}

// ---------------------------------------------------------------------------

function buildFrame(center, side, faceWidth) {
  if (center.length < 4) return null;
  const tangents = center.map((_, i) => tangentAt(center, i));
  let normals = tangents.map((t) => rot90(t));
  // Orient normals away from the eye (the brow grows above the eye line).
  const eyeC = side.eyeCenter;
  let away = 0;
  for (let i = 0; i < center.length; i++) {
    const dx = center[i].x - eyeC.x;
    const dy = center[i].y - eyeC.y;
    if (normals[i].x * dx + normals[i].y * dy > 0) away++;
  }
  if (away < center.length / 2) normals = normals.map((n) => v2(-n.x, -n.y));
  return { tangents, normals };
}

function movingAvg(pts, w) {
  const r = Math.floor(w / 2);
  const out = pts.map(() => v2());
  for (let i = 0; i < pts.length; i++) {
    let sx = 0, sy = 0, n = 0;
    for (let k = -r; k <= r; k++) {
      const j = i + k;
      if (j >= 0 && j < pts.length) {
        sx += pts[j].x;
        sy += pts[j].y;
        n++;
      }
    }
    out[i] = v2(sx / n, sy / n);
  }
  return out;
}

function smoothArray(arr) {
  const out = arr.slice();
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 1; i < arr.length - 1; i++) {
      out[i] = (arr[i - 1] + 2 * arr[i] + arr[i + 1]) / 4;
    }
  }
  for (let i = 0; i < arr.length; i++) arr[i] = out[i];
}

/**
 * Fallback frame from landmarks only (used when hair detection fails, e.g.
 * very light brows). Still face-relative, never a fixed coordinate.
 */
function landmarksFallback(side, faceWidth) {
  const n = FRAME_N;
  const brow = side.browTop; // 24 pts, inner→outer (assumed)
  const lash = side.eyeTop;
  const center = [];
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1);
    const b = brow[Math.min(brow.length - 1, Math.round(u * (brow.length - 1)))];
    const l = lash[Math.min(lash.length - 1, Math.round(u * (lash.length - 1)))];
    center.push(add(b, scale(v2(l.x - b.x, l.y - b.y), 0.45)));
  }
  const frame = buildFrame(center, side, faceWidth);
  if (!frame) return null;
  const hw = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1);
    const b = brow[Math.min(brow.length - 1, Math.round(u * (brow.length - 1)))];
    const l = lash[Math.min(lash.length - 1, Math.round(u * (lash.length - 1)))];
    hw[i] = clamp(dist(b, l) * 0.3, 1.5, faceWidth * 0.05);
  }
  smoothArray(hw);
  const start = center[0];
  const tail = center[n - 1];
  const peak = center.reduce((best, p, i) => (p.y < center[best].y ? i : best), 0);
  return {
    ok: true,
    method: "landmarks",
    centerline: center,
    tangents: frame.tangents,
    normals: frame.normals,
    halfWidth: hw,
    density: new Float32Array(n).fill(0.35),
    start,
    tail,
    peak: center[peak],
    peakIndex: peak,
    browLen: polylineLength(center),
    tailAngle: 10,
    eyeCenterX: side.eyeCenter.x,
    eyeCenterY: side.eyeCenter.y,
    roi: side.browROI,
    side: side.side,
  };
}
