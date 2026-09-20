// ---------------------------------------------------------------------------
// engine.test.mjs — Node test harness for the pure engine modules.
// Run: node test/engine.test.mjs
// ---------------------------------------------------------------------------

import {
  v2,
  resamplePolyline,
  pointInPoly,
  convexHull,
  catmullRom,
  catmull1D,
  delaunay,
  buildPiecewiseAffine,
  pointInTriangle,
  mulberry32,
  polylineLength,
  nearestOnPolyline,
} from "../js/tryon/lib/vec.js";
import {
  boxBlur,
  otsuThreshold,
  erode,
  dilate,
  largestComponent,
  polygonMask,
} from "../js/tryon/lib/image.js";
import { rgb2lab, lab2rgb, hexToRgb } from "../js/tryon/lib/lab.js";
import { estimatePose, poseQuality } from "../js/tryon/pose.js";
import { buildRegions } from "../js/tryon/landmarks.js";
import { analyzeBrow } from "../js/tryon/brow/analyze.js";
import { fitBrow, BROW_STYLES } from "../js/tryon/brow/model.js";
import { colorizeLips } from "../js/tryon/lip/colorize.js";
import { analyzeLiner, LINER_STYLES } from "../js/tryon/liner/analyze.js";
import * as booking from "../js/tryon/booking.js";

let pass = 0;
let fail = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    pass++;
    console.log(`  ✔ ${name}`);
  } catch (e) {
    fail++;
    failures.push({ name, error: e });
    console.log(`  ✘ ${name}\n    ${e.message}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg || "assertion failed");
}
function assertClose(a, b, tol, msg) {
  if (Math.abs(a - b) > tol) throw new Error(msg || `expected ${b} ± ${tol}, got ${a}`);
}

// ---------------------------------------------------------------------------
console.log("vec: curves & sampling");

test("resamplePolyline is uniform", () => {
  const line = Array.from({ length: 21 }, (_, i) => v2(i * 5, 0));
  const r = resamplePolyline(line, 11);
  r.forEach((p, i) => assertClose(p.x, i * 10, 1e-6));
});

test("pointInPoly square", () => {
  const sq = [v2(0, 0), v2(10, 0), v2(10, 10), v2(0, 10)];
  assert(pointInPoly(v2(5, 5), sq));
  assert(!pointInPoly(v2(15, 5), sq));
  assert(!pointInPoly(v2(-1, 5), sq));
});

test("convexHull excludes interior point", () => {
  const pts = [v2(0, 0), v2(10, 0), v2(10, 10), v2(0, 10), v2(5, 5)];
  const hull = convexHull(pts);
  assert(hull.length === 4, `hull size ${hull.length}`);
  assert(!hull.includes(4));
});

test("catmullRom passes through control points", () => {
  const pts = [v2(0, 0), v2(10, 20), v2(20, 5), v2(30, 25)];
  const curve = catmullRom(pts, 8);
  assertClose(curve[0].x, 0, 1e-6);
  assertClose(curve[curve.length - 1].x, 30, 1e-6);
  for (const cp of pts) {
    const d = Math.min(...curve.map((p) => Math.hypot(p.x - cp.x, p.y - cp.y)));
    assert(d < 1.5, `curve misses ${JSON.stringify(cp)} (d=${d})`);
  }
});

test("catmull1D interpolates control values", () => {
  const ctrl = [
    { u: 0, v: 0 },
    { u: 0.5, v: 10 },
    { u: 1, v: 0 },
  ];
  assertClose(catmull1D(ctrl, 0), 0, 1e-6);
  assertClose(catmull1D(ctrl, 0.5), 10, 0.4);
  assertClose(catmull1D(ctrl, 1), 0, 1e-6);
  assert(catmull1D(ctrl, -1) === 0);
});

test("nearestOnPolyline finds closest point", () => {
  const pts = [v2(0, 0), v2(10, 0)];
  const n = nearestOnPolyline(v2(3, 4), pts);
  assertClose(n.x, 3, 1e-9);
  assertClose(n.d, 4, 1e-9);
});

// ---------------------------------------------------------------------------
console.log("vec: Delaunay & piecewise-affine");

test("delaunay covers hull and obeys empty-circumcircle property", () => {
  const rng = mulberry32(42);
  const pts = Array.from({ length: 18 }, () => v2(rng() * 100, rng() * 100));
  const tris = delaunay(pts);
  assert(tris.length >= 16, `too few triangles: ${tris.length}`);
  const used = new Set();
  for (const t of tris) {
    for (const i of t) used.add(i);
    const a = pts[t[0]], b = pts[t[1]], c = pts[t[2]];
    const area = Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2;
    assert(area > 1e-6, "degenerate triangle");
  }
  assert(used.size === 18, `unused points: ${18 - used.size}`);
  // empty circumcircle property (tolerance for near-degenerate cases)
  const circle = (a, b, c) => {
    const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
    if (Math.abs(d) < 1e-9) return null;
    const ux =
      ((a.x * a.x + a.y * a.y) * (b.y - c.y) +
        (b.x * b.x + b.y * b.y) * (c.y - a.y) +
        (c.x * c.x + c.y * c.y) * (a.y - b.y)) /
      d;
    const uy =
      ((a.x * a.x + a.y * a.y) * (c.x - b.x) +
        (b.x * b.x + b.y * b.y) * (a.x - c.x) +
        (c.x * c.x + c.y * c.y) * (b.x - a.x)) /
      d;
    return { x: ux, y: uy, r: Math.hypot(ux - a.x, uy - a.y) };
  };
  let violations = 0;
  for (const t of tris) {
    const cc = circle(pts[t[0]], pts[t[1]], pts[t[2]]);
    if (!cc) continue;
    for (let i = 0; i < pts.length; i++) {
      if (t.includes(i)) continue;
      const p = pts[i];
      const d = Math.hypot(p.x - cc.x, p.y - cc.y);
      if (d < cc.r - 1.0) violations++; // tolerance for near-cocircular points
    }
  }
  assert(violations === 0, `${violations} circumcircle violations`);
});

test("piecewiseAffine identity", () => {
  const rng = mulberry32(7);
  const pts = Array.from({ length: 14 }, () => v2(rng() * 80, rng() * 80));
  const mapper = buildPiecewiseAffine(pts, pts);
  for (const q of [v2(20, 30), v2(40, 10), v2(60, 60)]) {
    const m = mapper.map(q);
    assertClose(m.x, q.x, 1e-6, `x: ${m.x} vs ${q.x}`);
    assertClose(m.y, q.y, 1e-6);
  }
});

test("piecewiseAffine reproduces a global rotation exactly", () => {
  const rng = mulberry32(99);
  const src = Array.from({ length: 16 }, () => v2(rng() * 100, rng() * 100));
  const th = (25 * Math.PI) / 180;
  const dst = src.map((p) => v2(p.x * Math.cos(th) - p.y * Math.sin(th), p.x * Math.sin(th) + p.y * Math.cos(th)));
  const mapper = buildPiecewiseAffine(src, dst);
  for (const q of [v2(25, 35), v2(50, 20), v2(75, 75)]) {
    const m = mapper.map(q);
    const ex = q.x * Math.cos(th) - q.y * Math.sin(th);
    const ey = q.x * Math.sin(th) + q.y * Math.cos(th);
    assertClose(m.x, ex, 1e-6, `x: ${m.x} vs ${ex}`);
    assertClose(m.y, ey, 1e-6);
  }
});

test("pointInTriangle basic", () => {
  const a = v2(0, 0), b = v2(10, 0), c = v2(0, 10);
  assert(pointInTriangle(v2(2, 2), a, b, c));
  assert(!pointInTriangle(v2(8, 8), a, b, c));
});

// ---------------------------------------------------------------------------
console.log("image: pixel ops");

test("boxBlur preserves constants", () => {
  const n = 40;
  const src = new Float32Array(n * n).fill(100);
  const out = boxBlur(src, n, n, 5);
  for (let i = 0; i < n * n; i++) assertClose(out[i], 100, 0.01);
});

test("boxBlur diffuses a spike", () => {
  const n = 41;
  const src = new Float32Array(n * n);
  src[20 * n + 20] = 255;
  const out = boxBlur(src, n, n, 4);
  assert(out[20 * n + 20] < 100, "center should be blurred down");
  assert(out[20 * n + 22] > 2, `neighbors should gain (got ${out[20 * n + 22]})`);
});

test("otsu separates bimodal values", () => {
  const n = 20;
  const vals = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) vals[i] = i < n * n / 2 ? 50 : 200;
  const t = otsuThreshold(vals, n, n, null);
  assert(t >= 50 && t < 195, `threshold ${t}`);
});

test("erode shrinks / dilate grows", () => {
  const w = 11, h = 11;
  let mask = new Uint8Array(w * h);
  for (let y = 3; y < 8; y++) for (let x = 3; x < 8; x++) mask[y * w + x] = 1;
  const area = (m) => m.reduce((s, v) => s + v, 0);
  assert(area(erode(mask, w, h)) < 25);
  assert(area(dilate(mask, w, h)) > 25);
});

test("largestComponent picks the big blob", () => {
  const w = 40, h = 20;
  const mask = new Uint8Array(w * h);
  for (let y = 2; y < 12; y++) for (let x = 2; x < 12; x++) mask[y * w + x] = 1;
  mask[15 * w + 25] = 1;
  mask[15 * w + 26] = 1;
  mask[16 * w + 25] = 1;
  const { area, bbox } = largestComponent(mask, w, h);
  assert(area === 100, `area ${area}`);
  assert(bbox.x === 2 && bbox.y === 2);
});

test("polygonMask fills square", () => {
  const poly = [v2(0, 0), v2(10, 0), v2(10, 10), v2(0, 10)];
  const m = polygonMask(poly, 10, 10);
  const area = m.reduce((s, v) => s + v, 0);
  assert(area === 100, `area ${area}`);
});

// ---------------------------------------------------------------------------
console.log("lab: color space");

test("sRGB↔LAB roundtrip", () => {
  const colors = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [200, 120, 110], [12, 8, 4], [245, 235, 225]];
  for (const [r, g, b] of colors) {
    const lab = rgb2lab(r, g, b);
    const [r2, g2, b2] = lab2rgb(lab[0], lab[1], lab[2]);
    assertClose(r2, r, 1.5, `R ${r}→${r2}`);
    assertClose(g2, g, 1.5, `G ${g}→${g2}`);
    assertClose(b2, b, 1.5, `B ${b}→${b2}`);
  }
});

test("hexToRgb", () => {
  assertClose(hexToRgb("#C9897B")[0], 201, 0);
  assertClose(hexToRgb("c9897b")[1], 137, 0);
});

// ---------------------------------------------------------------------------
console.log("synthetic face: regions, pose, brow detection, fit");

function syntheticLandmarks478() {
  const lm = [];
  for (let i = 0; i < 478; i++) {
    const a = (i / 478) * Math.PI * 2;
    lm.push({ x: 150 + 110 * Math.cos(a), y: 150 + 130 * Math.sin(a) });
  }
  const line = (x0, x1, y0, y1, n, arch = 0) =>
    Array.from({ length: n }, (_, k) => {
      const t = k / (n - 1);
      return { x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t - Math.sin(Math.PI * t) * arch };
    });
  const set = (idxs, pts) => idxs.forEach((i, k) => (lm[i] = pts[k]));
  // Eyes: inner corners (toward nose) sit lower than outer corners.
  // L-side eye (image left): inner (140,104) → outer (100,98), arch up.
  set([33, 246, 161, 160, 159, 158, 157, 173, 133], line(140, 100, 104, 98, 9, 5));
  // R-side eye (image right): inner (160,104) → outer (200,98).
  set([263, 466, 388, 387, 386, 385, 384, 398, 362], line(160, 200, 104, 98, 9, 5));
  set([7, 163, 144], [{ x: 120, y: 111 }, { x: 110, y: 112 }, { x: 100, y: 100 }]);
  set([249, 390, 373], [{ x: 180, y: 111 }, { x: 190, y: 112 }, { x: 200, y: 100 }]);
  // Brows (slightly above the eyes, arched)
  set([70, 63, 105, 66, 107, 55, 65, 52, 53, 46], line(98, 142, 86, 80, 10, 5));
  set([330, 296, 334, 293, 336, 285, 295, 282, 283, 276], line(158, 202, 80, 86, 10, 5));
  // Iris rings (eye centers ≈ (120,101) and (180,101))
  const ring = (cx, cy, r, n) => Array.from({ length: n }, (_, k) => {
    const a = (k / n) * Math.PI * 2;
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  });
  set([473, 474, 475, 476, 477], ring(120, 101, 3, 5));
  set([468, 469, 470, 471, 472], ring(180, 101, 3, 5));
  // Lips
  const ellipse = (cx, cy, rx, ry, n, yOff = 0) =>
    Array.from({ length: n }, (_, k) => {
      const a = (k / n) * Math.PI * 2;
      return { x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) + yOff };
    });
  set([61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 375, 321, 405, 314, 17, 84, 181, 91, 146], ellipse(150, 170, 28, 11, 20));
  set([78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308, 324, 318, 402, 317, 14, 87, 178, 88, 95], ellipse(150, 170, 19, 5, 20));
  lm[1] = { x: 150, y: 135 }; // nose tip
  lm[2] = { x: 150, y: 145 };
  lm[10] = { x: 150, y: 58 };
  lm[152] = { x: 150, y: 235 };
  lm[61] = { x: 122, y: 170 };
  lm[291] = { x: 178, y: 170 };
  return lm;
}

const SYN = syntheticLandmarks478();

test("buildRegions: side order & geometry", () => {
  const regions = buildRegions(SYN, {});
  assert(regions.sides[0].side === "L" && regions.sides[1].side === "R");
  assert(regions.sides[0].browTop[0].x < regions.sides[1].browTop[0].x);
  // inner corner of left-side eye is its RIGHTMOST corner (nearest face center)
  const s0 = regions.sides[0];
  assert(Math.abs(s0.innerCorner.x - 140) < 2, `inner x ${s0.innerCorner.x}`);
  assert(Math.abs(s0.outerCorner.x - 100) < 2);
  assert(s0.innerCorner.y > s0.outerCorner.y, "inner corner should sit lower");
  const lb = regions.lips.outer;
  assert(lb.length >= 60, "lips should be smoothed");
  assert(regions.noseTip.x === 150 && regions.noseTip.y === 135);
  // ROI polygons are finite and enclose the brow line
  for (const s of regions.sides) {
    for (const p of s.browROI) assert(Number.isFinite(p.x) && Number.isFinite(p.y));
  }
});

test("pose: synthetic frontal face ≈ zero", () => {
  const regions = buildRegions(SYN, {});
  const pose = estimatePose(regions);
  const q = poseQuality(pose);
  assertClose(pose.roll, 0, 2, `roll ${pose.roll}`);
  assert(Math.abs(pose.yaw) < 15, `yaw ${pose.yaw}`);
  assert(q.acceptable, "pose should pass");
});

test("pose: rolled face detected", () => {
  const th = (12 * Math.PI) / 180;
  const rot = SYN.map((p) => ({
    x: 150 + (p.x - 150) * Math.cos(th) - (p.y - 150) * Math.sin(th),
    y: 150 + (p.x - 150) * Math.sin(th) + (p.y - 150) * Math.cos(th),
  }));
  const regions = buildRegions(rot, {});
  const pose = estimatePose(regions);
  assertClose(pose.roll, 12, 2.5, `roll ${pose.roll}`);
});

// Synthetic photo: light skin, dark brow arc under the brow bone, noise specks.
function syntheticPhoto(regions) {
  const W = 300, H = 300;
  const data = new Uint8ClampedArray(W * H * 4);
  const rng = mulberry32(5);
  for (let i = 0; i < W * H; i++) {
    const n = rng() * 8 - 4;
    data[i * 4] = 216 + n;
    data[i * 4 + 1] = 205 + n;
    data[i * 4 + 2] = 196 + n;
    data[i * 4 + 3] = 255;
  }
  // dark arc for the left-side brow: follows the bone line, 7px below
  const side = regions.sides[0];
  const xs0 = Math.round(side.browTop[0].x);
  const xs1 = Math.round(side.browTop[side.browTop.length - 1].x);
  const boneY = (x) => {
    const t = (x - xs0) / (xs1 - xs0);
    return 86 + (80 - 86) * t - Math.sin(Math.PI * t) * 5;
  };
  for (let x = Math.max(0, xs0); x <= Math.min(W - 1, xs1); x++) {
    const yC = boneY(x) + 7;
    for (let dy = -3; dy <= 3; dy++) {
      const y = Math.round(yC + dy);
      if (y < 0 || y >= H) continue;
      const j = (y * W + x) * 4;
      const k = 1 - Math.abs(dy) / 4.5; // soft edges
      data[j] = 216 * (1 - k) + 55 * k;
      data[j + 1] = 205 * (1 - k) + 42 * k;
      data[j + 2] = 196 * (1 - k) + 35 * k;
    }
  }
  // a couple of random specks (should be removed by morphology)
  for (let s = 0; s < 6; s++) {
    const x = 20 + Math.floor(rng() * 260);
    const y = 40 + Math.floor(rng() * 60);
    const j = (y * W + x) * 4;
    data[j] = 90;
    data[j + 1] = 80;
    data[j + 2] = 70;
  }
  return { data, W, H };
}

let regionsCache = null;
function regions() {
  if (!regionsCache) regionsCache = buildRegions(SYN, {});
  return regionsCache;
}

test("brow detection: finds the synthetic arc", () => {
  const rg = regions();
  const { data, W, H } = syntheticPhoto(rg);
  const geom = analyzeBrow({ pixels: data, width: W, height: H, side: rg.sides[0], faceWidth: rg.faceWidth });
  assert(geom.ok, "should detect");
  assert(geom.method === "pixels", `method ${geom.method}`);
  const cl = geom.centerline;
  assert(cl.length === 48);
  // endpoints near the arc ends
  const x0 = rg.sides[0].browTop[0].x;
  const x1 = rg.sides[0].browTop[rg.sides[0].browTop.length - 1].x;
  assert(Math.abs(cl[0].x - x0) < 8, `start x ${cl[0].x} vs ${x0}`);
  assert(Math.abs(cl[47].x - x1) < 8, `tail x ${cl[47].x} vs ${x1}`);
  // centerline y tracks the arc (±6 px at several samples)
  for (const i of [0, 12, 24, 36, 47]) {
    const p = cl[i];
    const t = Math.max(0, Math.min(1, (p.x - x0) / (x1 - x0)));
    const yExp = 86 + (80 - 86) * t - Math.sin(Math.PI * t) * 5 + 7;
    assert(Math.abs(p.y - yExp) < 7, `y at ${i}: ${p.y} vs ${yExp}`);
  }
  assert(geom.halfWidth[24] > 2 && geom.halfWidth[24] < 12, `hw ${geom.halfWidth[24]}`);
  assert(geom.browLen > 30, `len ${geom.browLen}`);
});

test("brow fit: strokes stay inside the target band, deterministic", () => {
  const rg = regions();
  const { data, W, H } = syntheticPhoto(rg);
  const geom = analyzeBrow({ pixels: data, width: W, height: H, side: rg.sides[0], faceWidth: rg.faceWidth });
  const style = BROW_STYLES.micro;
  const f1 = fitBrow(style, geom, 12345);
  const f2 = fitBrow(style, geom, 12345);
  assert(f1.strokes.length === f2.strokes.length && f1.strokes.length > 40, `count ${f1.strokes.length}`);
  for (let i = 0; i < f1.strokes.length; i++) {
    assertClose(f1.strokes[i].x0, f2.strokes[i].x0, 1e-9, "deterministic x0");
  }
  const n = f1.centerline.length;
  let maxDev = 0;
  for (const s of f1.strokes) {
    for (const [px, py] of [[s.x0, s.y0], [s.x1, s.y1]]) {
      const near = nearestOnPolyline({ x: px, y: py }, f1.centerline);
      const u = (near.i + near.t) / (n - 1);
      if (u > 0.85) continue; // tail-extension region is deliberately longer
      const hw = f1.halfWidth[Math.max(0, Math.min(n - 1, Math.round(u * (n - 1))))];
      const dev = near.d / hw;
      if (dev > maxDev) maxDev = dev;
    }
  }
  assert(maxDev < 1.8, `strokes too far outside band: ${maxDev}`);
  // tail extension must not pull the tail toward the eye (down)
  const tail = f1.centerline[n - 1];
  assert(tail.y < geom.centerline[n - 1].y + 10, "tail geometry sanity");
});

test("brow fit: powder style fits too", () => {
  const rg = regions();
  const { data, W, H } = syntheticPhoto(rg);
  const geom = analyzeBrow({ pixels: data, width: W, height: H, side: rg.sides[0], faceWidth: rg.faceWidth });
  const fitted = fitBrow(BROW_STYLES.powder, geom, 777);
  assert(fitted.powder && fitted.powder.gain > 0);
  assert(fitted.strokes.length > 5);
  assert(fitted.centerline.length === 48);
});

// ---------------------------------------------------------------------------
console.log("lip: colorization");

test("colorizeLips shifts hue, preserves texture, spares outside", () => {
  const w = 48, h = 24;
  const data = new Uint8ClampedArray(w * h * 4);
  const rng = mulberry32(3);
  for (let i = 0; i < w * h; i++) {
    const tex = (rng() - 0.5) * 24; // texture
    data[i * 4] = 195 + tex;
    data[i * 4 + 1] = 118 + tex * 0.8;
    data[i * 4 + 2] = 108 + tex * 0.8;
    data[i * 4 + 3] = 255;
  }
  const maskF = new Float32Array(w * h);
  const bandF = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      maskF[y * w + x] = x > 6 && x < w - 6 && y > 5 && y < h - 5 ? 1 : 0;
  const [pr, pg, pb] = hexToRgb("#7A2E44");
  const [pL, pa, pb2] = rgb2lab(pr, pg, pb);
  const original = Uint8ClampedArray.from(data);
  colorizeLips(data, w, h, maskF, bandF, {
    pigment: [pL, pa, pb2],
    Lmean: 150,
    center: { x: w / 2, y: h / 2 },
    dmax: 30,
    strength: 0.8,
  });
  // inside: color changed toward berry
  const jIn = (12 * w + 24) * 4;
  const jOut = (2 * w + 2) * 4;
  const dIn = Math.hypot(data[jIn] - original[jIn], data[jIn + 1] - original[jIn + 1], data[jIn + 2] - original[jIn + 2]);
  const dOut = Math.hypot(data[jOut] - original[jOut], data[jOut + 1] - original[jOut + 1], data[jOut + 2] - original[jOut + 2]);
  assert(dIn > 8, `inside should change (d=${dIn})`);
  assert(dOut < 0.5, `outside must be untouched (d=${dOut})`);
  // luminance contrast preserved inside (texture survives)
  const lums = [];
  for (let y = 6; y < h - 6; y++)
    for (let x = 7; x < w - 7; x++) {
      const j = (y * w + x) * 4;
      lums.push(0.2126 * data[j] + 0.7152 * data[j + 1] + 0.0722 * data[j + 2]);
    }
  const mean = lums.reduce((s, v) => s + v, 0) / lums.length;
  const std = Math.sqrt(lums.reduce((s, v) => s + (v - mean) ** 2, 0) / lums.length);
  assert(std > 2.5, `luminance texture should survive, std=${std}`);
});

// ---------------------------------------------------------------------------
console.log("liner: geometry");

test("liner: path follows lash line, wing points up & away", () => {
  const rg = regions();
  const side = rg.sides[0];
  const fitted = analyzeLiner(side, LINER_STYLES.cat, 44, rg.noseTip.x);
  assert(fitted.path.length === 44);
  // path starts at the inner corner
  assert(Math.abs(fitted.inner.x - 140) < 3, `inner ${fitted.inner.x}`);
  assert(Math.abs(fitted.outer.x - 100) < 3);
  // normals point away from iris (upward for an iris below the lash line)
  let upCount = 0;
  for (let i = 0; i < fitted.path.length; i++) {
    if (fitted.normals[i].y < 0) upCount++;
  }
  assert(upCount > fitted.path.length * 0.8, `normals up ${upCount}/${fitted.path.length}`);
  // wing
  assert(fitted.wing, "cat style has a wing");
  const tip = fitted.wing.pts[fitted.wing.pts.length - 1];
  assert(tip.y < fitted.outer.y - 2, `wing should lift (tip ${tip.y} vs outer ${fitted.outer.y})`);
  assert(tip.x < fitted.outer.x - 2, `wing should extend away for L side (tip ${tip.x} vs outer ${fitted.outer.x})`);
  // widths taper to the tip
  assert(fitted.wing.widths[fitted.wing.widths.length - 1] < fitted.wing.widths[0]);
  // lash style has no wing
  const lash = analyzeLiner(side, LINER_STYLES.lash, 44, rg.noseTip.x);
  assert(lash.wing === null);
});

test("liner: both sides mirror correctly", () => {
  const rg = regions();
  const style = LINER_STYLES.wing; // strong lift + long wing → direction checks are meaningful
  const L = analyzeLiner(rg.sides[0], style, 44, rg.noseTip.x);
  const R = analyzeLiner(rg.sides[1], style, 44, rg.noseTip.x);
  assert(L.inner.x > L.outer.x, "L side: inner nearer center");
  assert(R.inner.x < R.outer.x, "R side: inner nearer center");
  // wings must be mirror images: L points left+up, R points right+up
  const tL = L.wing.pts[L.wing.pts.length - 1];
  const tR = R.wing.pts[R.wing.pts.length - 1];
  assert(tL.x < L.outer.x - 2, `L wing left: ${tL.x} vs ${L.outer.x}`);
  assert(tL.y < L.outer.y - 2, `L wing up: ${tL.y} vs ${L.outer.y}`);
  assert(tR.x > R.outer.x + 2, `R wing away: ${tR.x} vs ${R.outer.x}`);
  assert(tR.y < R.outer.y - 2, `R wing up: ${tR.y} vs ${R.outer.y}`);
  // mirror symmetry about the face center line
  const cx = rg.noseTip.x;
  assertClose(2 * cx - tL.x, tR.x, 1.5, "wing x mirror");
  assertClose(tL.y, tR.y, 0.8, "wing y mirror");
});

// ---------------------------------------------------------------------------
console.log("booking: business rules (pure module)");

test("booking: success text is EXACTLY the required phrase", () => {
  assert(booking.BOOKING_SUCCESS_TEXT === "درخواست شما آماده ارسال برای هماهنگی است.");
});

test("booking: disclaimer never claims a confirmed slot", () => {
  assert(/پیش‌نویس/.test(booking.BOOKING_DISCLAIMER), "mentions پیش‌نویس (draft)");
  assert(!/رزرو شد/.test(booking.BOOKING_DISCLAIMER) && !/ثبت شد/.test(booking.BOOKING_DISCLAIMER));
});

test("booking: normalizePhone handles 09, +98 and 0098 forms", () => {
  assert(booking.normalizePhone("09058674412") === "9058674412");
  assert(booking.normalizePhone("+98 905 867 4412") === "9058674412");
  assert(booking.normalizePhone("0098-905-867-4412") === "9058674412");
});

test("booking: normalizePhone rejects invalid numbers", () => {
  assert(booking.normalizePhone("09058674") === "", "too short");
  assert(booking.normalizePhone("0905867441234") === "", "too long");
  assert(booking.normalizePhone("0905867441a") === "", "letters");
  assert(booking.normalizePhone("") === "", "empty");
  assert(booking.normalizePhone("0123456789") === "", "fixed-line");
});

test("booking: buildWaDraft targets the real WhatsApp number", () => {
  const url = booking.buildWaDraft({
    serviceLabel: "میکروبلیدینگ",
    styleLabel: "میکرو کلاسیک",
    name: "سارا",
    phone: "9121234567",
    time: "آینده هفته",
    note: "لبم حساسه",
  });
  assert(url.startsWith("https://wa.me/989058674412?text="), url.slice(0, 40));
  const text = decodeURIComponent(url.split("text=")[1]);
  assert(text.includes("سلام عسل جان، از سایت دیدمت 🌸"), "greeting");
  assert(text.includes("• خدمات: میکروبلیدینگ"), "service line");
  assert(text.includes("• مدل: میکرو کلاسیک"), "style line");
  assert(text.includes("• نام: سارا"), "name line");
  assert(text.includes("• موبایل: 09121234567"), "phone shown as 09…");
  assert(text.includes("• زمان دلخواه: آینده هفته"), "time line");
  assert(text.includes("• یادداشت: لبم حساسه"), "note line");
});

test("booking: buildWaDraft omits optional style/time/note lines", () => {
  const url = booking.buildWaDraft({
    serviceLabel: "ریموو",
    styleLabel: "",
    name: "مریم",
    phone: "9333333333",
    time: "",
    note: "",
  });
  const text = decodeURIComponent(url.split("text=")[1]);
  assert(!text.includes("• مدل:"), "no style line when empty");
  assert(!text.includes("زمان دلخواه"), "no time line when empty");
  assert(!text.includes("یادداشت"), "no note line when empty");
  assert(text.includes("• خدمات: ریموو"), "remove service still present");
});

// ---------------------------------------------------------------------------
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`- ${f.name}: ${f.error.message}`);
  process.exit(1);
}
