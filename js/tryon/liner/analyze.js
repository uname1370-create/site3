// ---------------------------------------------------------------------------
// liner/analyze.js — builds the eyeliner path from the detected upper-lash
// landmarks (curve fit), and the wing from face-relative eye geometry
// (eye width, outer-corner direction) — never a fixed canvas fraction.
// Pure module; testable in Node.
// ---------------------------------------------------------------------------

import {
  catmullRom,
  resamplePolyline,
  tangentAt,
  rot90,
  v2,
  norm,
  fromAngle,
  angleOf,
  clamp,
  polylineLength,
} from "../lib/vec.js";

export const LINER_STYLES = {
  lash:    { id: "lash",    name: "بن‌مژه",    hint: "خیلی ظریف بین مژه‌ها",    inner: 0.010, outer: 0.022, wing: 0.0,  lift: 0,   blur: 0.5, inset: 0.62, core: 0.30, alpha: 0.55, smoky: false },
  classic: { id: "classic", name: "کلاسیک",    hint: "خط نازک و تمیز",           inner: 0.015, outer: 0.034, wing: 0.07, lift: 5,   blur: 0.35, inset: 0.40, core: 0.5,  alpha: 0.8,  smoky: false },
  cat:     { id: "cat",     name: "گربه‌ای",   hint: "باله کشیده و نرم",        inner: 0.016, outer: 0.040, wing: 0.17, lift: 13,  blur: 0.3,  inset: 0.36, core: 0.55, alpha: 0.9,  smoky: false },
  arabic:  { id: "arabic",  name: "عربی",      hint: "ضخیم و پررنگ",             inner: 0.027, outer: 0.060, wing: 0.10, lift: 7,   blur: 0.45, inset: 0.30, core: 0.6,  alpha: 0.95, smoky: false },
  fox:     { id: "fox",     name: "فاکس‌آی",    hint: "باله کشیده رو به بالا",     inner: 0.015, outer: 0.038, wing: 0.21, lift: 24,  blur: 0.3,  inset: 0.36, core: 0.5,  alpha: 0.85, smoky: false },
  smoky:   { id: "smoky",   name: "دودی",      hint: "محو و نرم",               inner: 0.020, outer: 0.050, wing: 0.09, lift: 7,   blur: 1.5,  inset: 0.46, core: 0.28, alpha: 0.55, smoky: true },
  wing:    { id: "wing",    name: "بالدار",     hint: "باله تیز و مشخص",          inner: 0.016, outer: 0.042, wing: 0.19, lift: 17,  blur: 0.28, inset: 0.34, core: 0.55, alpha: 0.92, smoky: false },
};

/**
 * @param {object} side regions.sides entry (pixel space)
 * @param {object} style LINER_STYLES entry
 * @param {number} n samples of the final path
 * @param {number} [faceCenterX] nose-tip x — used to decide which lash
 *   corner is inner (falls back to iris distance when omitted)
 */
export function analyzeLiner(side, style, n = 44, faceCenterX) {
  // Normalize so index 0 is always the INNER corner (near the face center).
  const raw = side.eyeTop;
  const eyeCenter = side.eyeCenter;
  const corners = [raw[0], raw[raw.length - 1]];
  let innerIdx;
  if (Number.isFinite(faceCenterX)) {
    innerIdx =
      Math.abs(corners[0].x - faceCenterX) < Math.abs(corners[1].x - faceCenterX) ? 0 : 1;
  } else {
    innerIdx = distTo(corners[0], eyeCenter) < distTo(corners[1], eyeCenter) ? 0 : 1;
  }
  const pts = innerIdx === 0 ? raw.slice() : raw.slice().reverse();

  let path = catmullRom(pts, 6);
  path = resamplePolyline(path, n);

  // Normal pointing AWAY from the iris (the lid side carries the liner).
  const normals = path.map((_, i) => rot90(tangentAt(path, i)));
  let away = 0;
  for (let i = 0; i < n; i++) {
    const dx = path[i].x - eyeCenter.x;
    const dy = path[i].y - eyeCenter.y;
    if (normals[i].x * dx + normals[i].y * dy > 0) away++;
  }
  if (away < n / 2) normals.forEach((nm) => (nm.x = -nm.x, nm.y = -nm.y));

  // Width profile (px): thin at inner corner → max near outer corner.
  const W = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1);
    const base = style.inner + (style.outer - style.inner) * Math.pow(u, 1.25);
    W[i] = base * side.eyeWidth;
  }

  // Wing: extend along the outer tangent, rotated upward by `lift`,
  // length proportional to eye width (face-relative).
  let wingPts = null;
  let wingW = null;
  if (style.wing > 0) {
    const outer = path[n - 1];
    // Wing follows the eye axis (iris → outer corner), lifted upward.
    const axis = norm(v2(outer.x - eyeCenter.x, outer.y - eyeCenter.y));
    const aAxis = angleOf(axis);
    const liftRad = (style.lift * Math.PI) / 180;
    const aL = aAxis - liftRad;
    const aR = aAxis + liftRad;
    const chosen = Math.sin(aL) < Math.sin(aR) ? aL : aR; // higher tip wins
    const dir = fromAngle(chosen);
    const wingLen = style.wing * side.eyeWidth;
    const steps = 6;
    wingPts = [outer];
    wingW = [W[n - 1]];
    for (let k = 1; k <= steps; k++) {
      const u = k / steps;
      // slight cat-curl: accelerate the upward sweep near the tip
      // (pure -y bias so the two sides stay mirror images)
      const liftBias = Math.pow(u, 1.6) * (style.lift / 30) * wingLen * 0.35;
      wingPts.push({
        x: outer.x + dir.x * wingLen * u,
        y: outer.y + dir.y * wingLen * u - liftBias,
      });
      const taper = 1 - u;
      wingW.push(Math.max(0.35, W[n - 1] * (0.25 + 0.75 * taper * taper)));
    }
  }

  return {
    path,
    normals,
    width: W,
    wing: wingPts ? { pts: wingPts, widths: wingW } : null,
    inner: path[0],
    outer: path[n - 1],
    eyeWidth: side.eyeWidth,
    side: side.side,
    style,
  };
}

function distTo(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
