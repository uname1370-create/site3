// ---------------------------------------------------------------------------
// lab.js — sRGB ↔ CIELAB (D65). Used for texture-preserving pigment
// colorization: shift hue in a perceptual space while keeping the per-pixel
// luminance structure of the original photo.
// ---------------------------------------------------------------------------

// sRGB -> linear LUT
const S2L = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  S2L[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
// linear -> sRGB LUT
const L2S = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  L2S[i] = Math.round((c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055) * 255);
}

const Xn = 0.95047, Yn = 1.0, Zn = 1.08883;

function fLab(t) {
  return t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
}
function fLabInv(t) {
  const t3 = t * t * t;
  return t3 > 0.008856 ? t3 : (t - 16 / 116) / 7.787;
}

/** rgb (0..255 triple) → [L 0..100, a, b] */
export function rgb2lab(r, g, b) {
  const rl = S2L[r & 255];
  const gl = S2L[g & 255];
  const bl = S2L[b & 255];
  const x = (0.4124564 * rl + 0.3575761 * gl + 0.1804375 * bl) / Xn;
  const y = (0.2126729 * rl + 0.7151522 * gl + 0.072175 * bl) / Yn;
  const z = (0.0193339 * rl + 0.119192 * gl + 0.9503041 * bl) / Zn;
  const fx = fLab(x), fy = fLab(y), fz = fLab(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** [L,a,b] → rgb 0..255 (clamped) */
export function lab2rgb(L, a, b) {
  const fy = (L + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  const x = fLabInv(fx) * Xn;
  const y = fLabInv(fy) * Yn;
  const z = fLabInv(fz) * Zn;
  const rl = 3.2404542 * x - 1.5371385 * y - 0.4985314 * z;
  const gl = -0.969266 * x + 1.8760108 * y + 0.041556 * z;
  const bl = 0.0556434 * x - 0.2040259 * y + 1.0572252 * z;
  // linear → sRGB gamma
  const toS = (c) => {
    const s = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(Math.max(c, 0), 1 / 2.4) - 0.055;
    return Math.max(0, Math.min(255, Math.round(s * 255)));
  };
  return [toS(rl), toS(gl), toS(bl)];
}

export function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [128, 128, 128];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex(r, g, b) {
  return (
    "#" +
    [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("")
  );
}

/** Lab color whose lightness is scaled toward `targetL` (clamped 0..100). */
export function scaleL(ab, targetL) {
  return [Math.max(0, Math.min(100, targetL)), ab[1], ab[2]];
}
