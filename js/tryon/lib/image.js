// ---------------------------------------------------------------------------
// image.js — pure pixel-math helpers (typed arrays only, no DOM).
// Used for: local background estimation, adaptive thresholding (brow hair
// extraction), morphology, connected components, feathering channels.
// ---------------------------------------------------------------------------

/** Luminance channel (0..255) from RGBA data. */
export function luminance(data, w, h) {
  const out = new Float32Array(w * h);
  for (let i = 0, j = 0; i < w * h; i++, j += 4) {
    out[i] = 0.2126 * data[j] + 0.7152 * data[j + 1] + 0.0722 * data[j + 2];
  }
  return out;
}

/**
 * Separable box blur on a Float32 channel. radius <= 0 → copy.
 * Uses running sums (O(n) per pass).
 */
export function boxBlur(src, w, h, radius) {
  if (radius <= 0) return src.slice();
  const r = Math.max(1, Math.round(radius));
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  // Horizontal
  for (let y = 0; y < h; y++) {
    let acc = 0;
    const row = y * w;
    for (let x = -r; x <= r; x++) acc += src[row + clampI(x, w - 1)];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = acc / (2 * r + 1);
      const addX = clampI(x + r + 1, w - 1);
      const subX = clampI(x - r, w - 1);
      acc += src[row + addX] - src[row + subX];
    }
  }
  // Vertical
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[clampI(y, h - 1) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / (2 * r + 1);
      const addY = clampI(y + r + 1, h - 1);
      const subY = clampI(y - r, h - 1);
      acc += tmp[addY * w + x] - tmp[subY * w + x];
    }
  }
  return out;
}

function clampI(x, max) {
  return x < 0 ? 0 : x > max ? max : x;
}

/**
 * Otsu threshold over `values` (0..255) at positions where `mask` is true.
 * Returns a threshold, or -1 when there is no signal.
 */
export function otsuThreshold(values, w, h, mask) {
  const hist = new Float64Array(256);
  let total = 0;
  for (let i = 0; i < w * h; i++) {
    if (mask && !mask[i]) continue;
    const v = Math.max(0, Math.min(255, Math.round(values[i])));
    hist[v]++;
    total++;
  }
  if (total < 16) return -1;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let bestT = -1;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) {
      best = between;
      bestT = t;
    }
  }
  return bestT;
}

/** 3x3 erosion (binary, 4-connected). In-place-safe (returns new). */
export function erode(mask, w, h) {
  const out = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (
        mask[i - 1] &&
        mask[i + 1] &&
        mask[i - w] &&
        mask[i + w]
      ) {
        out[i] = 1;
      }
    }
  }
  return out;
}

/** 3x3 dilation (binary, 4-connected). */
export function dilate(mask, w, h) {
  const out = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (mask[i - 1] || mask[i + 1] || mask[i - w] || mask[i + w]) out[i] = 1;
    }
  }
  return out;
}

/** Opening = erode then dilate (removes specks, keeps mass). */
export function open(mask, w, h, iterations = 1) {
  let m = mask;
  for (let k = 0; k < iterations; k++) m = dilate(erode(m, w, h), w, h);
  return m;
}

/**
 * Largest 4-connected component of a binary mask.
 * Returns { mask, area, bbox }.
 */
export function largestComponent(mask, w, h) {
  const labels = new Int32Array(w * h).fill(-1);
  const stack = new Int32Array(w * h);
  let bestArea = 0;
  let bestLabel = -1;
  const areas = [];
  for (let start = 0; start < w * h; start++) {
    if (!mask[start] || labels[start] !== -1) continue;
    let label = areas.length;
    let sp = 0;
    stack[sp++] = start;
    labels[start] = label;
    let area = 0;
    while (sp > 0) {
      const i = stack[--sp];
      area++;
      const x = i % w;
      const y = (i / w) | 0;
      if (x > 0 && mask[i - 1] && labels[i - 1] === -1) { labels[i - 1] = label; stack[sp++] = i - 1; }
      if (x < w - 1 && mask[i + 1] && labels[i + 1] === -1) { labels[i + 1] = label; stack[sp++] = i + 1; }
      if (y > 0 && mask[i - w] && labels[i - w] === -1) { labels[i - w] = label; stack[sp++] = i - w; }
      if (y < h - 1 && mask[i + w] && labels[i + w] === -1) { labels[i + w] = label; stack[sp++] = i + w; }
    }
    areas.push(area);
    if (area > bestArea) {
      bestArea = area;
      bestLabel = label;
    }
  }
  if (bestLabel === -1) {
    return { mask: new Uint8Array(w * h), area: 0, bbox: null };
  }
  const out = new Uint8Array(w * h);
  let minX = w, minY = h, maxX = 0, maxY = 0;
  for (let i = 0; i < w * h; i++) {
    if (labels[i] === bestLabel) {
      out[i] = 1;
      const x = i % w;
      const y = (i / w) | 0;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  return {
    mask: out,
    area: bestArea,
    bbox: { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 },
  };
}

/**
 * Build a polygon mask (0/1) over an w×h grid by point-in-polygon test.
 * The polygon is given in grid coordinates (can exceed the grid; clipping
 * happens naturally).
 */
export function polygonMask(poly, w, h) {
  const mask = new Uint8Array(w * h);
  if (!poly || poly.length < 3) return mask;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of poly) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  minX = Math.max(0, Math.floor(minX));
  minY = Math.max(0, Math.floor(minY));
  maxX = Math.min(w - 1, Math.ceil(maxX));
  maxY = Math.min(h - 1, Math.ceil(maxY));
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (pointInPolyFast(poly, x + 0.5, y + 0.5)) mask[y * w + x] = 1;
    }
  }
  return mask;
}

function pointInPolyFast(poly, x, y) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi || 1e-12) + xi) inside = !inside;
  }
  return inside;
}

/** Percentile over a Float32Array (copy + sort; fine for small ROIs). */
export function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = Float32Array.from(values).sort();
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
  return sorted[idx];
}
