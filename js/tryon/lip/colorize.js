// ---------------------------------------------------------------------------
// lip/colorize.js — pure per-pixel pigment colorization in CIELAB.
//
// Texture preservation principle:
//   L' = L + (Lp - L)·k·m          ← per-pixel partial shift keeps the
//                                     original luminance *structure*
//   a' = a + (ap - a)·kA·m         ← hue channels move fully toward pigment
//   L' = L̄ + (L' - L̄)·keep         ← slight contrast compression (velvet)
// where m is the feathered mask (0 outside, 0..1 inside). Inner mouth /
// teeth are excluded by the mask itself (built in render.js).
// ---------------------------------------------------------------------------

import { rgb2lab, lab2rgb } from "../lib/lab.js";

/**
 * @param {Uint8ClampedArray} data RGBA pixels of the lip ROI (in place)
 * @param {number} w, h ROI size
 * @param {Float32Array} maskF feathered mask 0..1 (ROI coords)
 * @param {Float32Array} bandF edge band 0..1 (linelike outer rim)
 * @param {object} opts
 *   pigment [L,a,b], Lmean (ROI mean luminance), center {x,y}, dmax,
 *   strength 0..1.4 (user shade), keepContrast
 */
export function colorizeLips(data, w, h, maskF, bandF, opts) {
  const [pL, pa, pb] = opts.pigment;
  const keepL = 0.42; // how much of the lightness difference to apply
  const keepA = 0.92;
  const keep = opts.keepContrast ?? 0.84;
  const strength = opts.strength ?? 0.6;
  const cx = opts.center.x;
  const cy = opts.center.y;
  const dmax = Math.max(1, opts.dmax);
  const Lmean = opts.Lmean ?? 128;
  const bandDarken = 10; // rim slightly deeper (liner edge)

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const m = maskF[i];
      if (m < 0.012) continue;
      // radial falloff: center stays fresher, border carries the pigment
      const d = Math.hypot(x - cx, y - cy) / dmax;
      const f = m * (0.56 + 0.44 * Math.min(1, d)) * strength;
      const j = i * 4;
      const [L, a, b] = rgb2lab(data[j], data[j + 1], data[j + 2]);
      const band = bandF ? bandF[i] * m : 0;
      let L2 = L + (pL - L) * keepL * f - bandDarken * band * strength;
      const a2 = a + (pa - a) * keepA * f;
      const b2 = b + (pb - b) * keepA * f;
      L2 = Lmean + (L2 - Lmean) * keep;
      const [r, g, bb] = lab2rgb(L2, a2, b2);
      data[j] = r;
      data[j + 1] = g;
      data[j + 2] = bb;
      data[j + 3] = 255;
    }
  }
}
