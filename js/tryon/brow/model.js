// ---------------------------------------------------------------------------
// brow/model.js — PMU brow model assets + the fit stage.
//
// Each style is an asset in UNIT BROW SPACE:
//   u  ∈ [0,1]  along the brow (0 = inner head, 1 = tail)
//   dy in local half-widths  (arch lift; positive = lifted above natural line)
//   w  in local half-widths  (target thickness multiplier)
// Strokes are procedural specs (position/angle/length/width/opacity/curvature)
// that are mapped onto the user's actual brow frame during fit():
//   centerline/tangent/normal/half-width from brow/analyze.js
// → target centerline  = natural + lift(u)·normal
// → tail extension     = geometric (natural tail tangent rotated toward eye)
// → strokes            = resampled along the TARGET frame with hair-flow slant
// The result is a pure geometry transform (scale + rotation + curvature +
// non-rigid per-user deformation) — the same asset never lands on two faces
// in the same pixel space.
// ---------------------------------------------------------------------------

import {
  catmull1D,
  resamplePolyline,
  tangentAt,
  rot90,
  v2,
  add,
  scale,
  norm,
  fromAngle,
  angleOf,
  dist,
  polylineLength,
  mulberry32,
  clamp,
} from "../lib/vec.js";

// ---------------------------------------------------------------------------
// Style assets
// ---------------------------------------------------------------------------

export const BROW_STYLES = {
  micro: {
    id: "micro",
    name: "میکروبلیدینگ",
    hint: "تار موی واقعی، قوس طبیعی",
    kind: "hairstroke",
    controlPoints: [
      { u: 0.0, dy: 0.0, w: 0.8 },
      { u: 0.22, dy: 0.10, w: 0.95 },
      { u: 0.48, dy: 0.22, w: 1.12 },
      { u: 0.68, dy: 0.12, w: 1.0 },
      { u: 0.85, dy: 0.02, w: 0.72 },
      { u: 1.0, dy: 0.0, w: 0.34 },
    ],
    strokes: {
      count: 175,
      headFade: true,
      slantHead: 18, // degrees off local tangent (hair grows toward tail)
      slantArch: 34,
      slantTail: 52,
      lenRange: [0.055, 0.115], // fraction of brow length
      wdtRange: [0.75, 1.9], // fraction of clamped local width
      opRange: [0.30, 0.58],
      curvRange: [0.12, 0.4],
      fillWeight: 0.5, // extra strokes where natural hair is sparse
    },
    powder: { gain: 0.16, head: 0.55, tail: 1.0, width: 1.0 },
    thickness: 1.0,
    arch: 0.55,
    tailAngle: 7, // degrees toward the eye (down)
    tailExt: 0.14,
    colorProfile: { base: "#3A2417", opacity: 0.55 },
  },
  powder: {
    id: "powder",
    name: "پودری (اومبره)",
    hint: "سایه نرم، سر روشن و دم تیره",
    kind: "powder",
    controlPoints: [
      { u: 0.0, dy: 0.02, w: 0.9 },
      { u: 0.25, dy: 0.12, w: 1.02 },
      { u: 0.5, dy: 0.22, w: 1.14 },
      { u: 0.72, dy: 0.14, w: 1.05 },
      { u: 0.88, dy: 0.05, w: 0.78 },
      { u: 1.0, dy: 0.02, w: 0.4 },
    ],
    strokes: {
      count: 26, // faint definition strokes only
      headFade: true,
      slantHead: 16,
      slantArch: 30,
      slantTail: 46,
      lenRange: [0.04, 0.08],
      wdtRange: [0.6, 1.2],
      opRange: [0.16, 0.3],
      curvRange: [0.1, 0.3],
      fillWeight: 0.2,
    },
    powder: { gain: 0.6, head: 0.3, tail: 1.0, width: 1.06 },
    thickness: 1.05,
    arch: 0.55,
    tailAngle: 8,
    tailExt: 0.12,
    colorProfile: { base: "#4A3122", opacity: 0.85 },
  },
  natural: {
    id: "natural",
    name: "طبیعی (پر کر)",
    hint: "تار ظریف، فقط پر کردن جاهای خالی",
    kind: "sparse",
    controlPoints: [
      { u: 0.0, dy: 0.0, w: 0.75 },
      { u: 0.25, dy: 0.06, w: 0.88 },
      { u: 0.5, dy: 0.12, w: 0.95 },
      { u: 0.75, dy: 0.06, w: 0.85 },
      { u: 1.0, dy: 0.0, w: 0.3 },
    ],
    strokes: {
      count: 85,
      headFade: true,
      slantHead: 14,
      slantArch: 26,
      slantTail: 42,
      lenRange: [0.04, 0.085],
      wdtRange: [0.55, 1.25],
      opRange: [0.2, 0.42],
      curvRange: [0.1, 0.32],
      fillWeight: 0.75,
    },
    powder: { gain: 0.09, head: 0.5, tail: 0.9, width: 0.95 },
    thickness: 0.9,
    arch: 0.3,
    tailAngle: 6,
    tailExt: 0.1,
    colorProfile: { base: "#6A4A38", opacity: 0.45 },
  },
};

// ---------------------------------------------------------------------------
// Fit
// ---------------------------------------------------------------------------

/**
 * Fit a style onto a detected brow frame.
 * @param {object} style BROW_STYLES entry
 * @param {object} geom  result of analyzeBrow()
 * @param {number} seed  deterministic seed (stable across re-renders)
 * @param {number} strokeScale  <1 for fast preview
 * @returns fitted brow { centerline, tangents, normals, halfWidth, strokes, powder, debug }
 */
export function fitBrow(style, geom, seed, strokeScale = 1) {
  const N = geom.centerline.length;
  const center = geom.centerline;
  const hw = geom.halfWidth;
  const normals = geom.normals;

  // 1) Target centerline: natural line lifted by the style arch profile.
  const liftAt = (u) => catmull1D(style.controlPoints.map((c) => ({ u: c.u, v: c.dy })), u);
  const widthAt = (u) => catmull1D(style.controlPoints.map((c) => ({ u: c.u, v: c.w })), u);
  const target = center.map((p, i) => {
    const u = i / (N - 1);
    const lift = liftAt(u) * style.arch * hw[i];
    return add(p, scale(normals[i], -lift)); // -normal = away from eye (up)
  });

  // 2) Tail extension (geometric, from the natural tail tangent).
  let path = target.slice();
  if (style.tailExt > 0) {
    const tIdx = Math.floor(N * 0.92);
    const T = tangentAt(target, tIdx);
    const P = target[tIdx];
    const eyeDir = norm(v2(geom.eyeCenterX - P.x, geom.eyeCenterY - P.y));
    const a = angleOf(T);
    const aEye = angleOf(eyeDir);
    // rotate the tail tangent a few degrees toward the eye (downward sweep)
    let d = a;
    const tRad = (style.tailAngle * Math.PI) / 180;
    d = rotateToward(a, aEye, tRad);
    const dir = fromAngle(d);
    const extN = 8;
    const step = (style.tailExt * geom.browLen) / extN;
    for (let k = 1; k <= extN; k++) {
      const u = k / extN;
      path.push(add(P, scale(dir, step * u)));
    }
  }
  path = resamplePolyline(path, N);

  // 3) Rebuild the frame on the target path.
  const tangents = path.map((_, i) => tangentAt(path, i));
  const normalsT = tangents.map((t) => rot90(t));
  {
    const eyeC = { x: geom.eyeCenterX, y: geom.eyeCenterY };
    let away = 0;
    for (let i = 0; i < N; i++) {
      const dx = path[i].x - eyeC.x;
      const dy = path[i].y - eyeC.y;
      if (normalsT[i].x * dx + normalsT[i].y * dy > 0) away++;
    }
    if (away < N / 2) normalsT.forEach((n) => (n.x = -n.x, n.y = -n.y));
  }
  const hwT = new Float32Array(N);
  const hwMax = Math.max(1.5, geom.browLen * 0.06);
  for (let i = 0; i < N; i++) {
    const u = i / (N - 1);
    hwT[i] = clamp(hw[i] * widthAt(u) * style.thickness, 1.0, hwMax);
  }
  // taper any extended tail
  if (path.length === N && style.tailExt > 0) {
    const extIdx = Math.floor(N * (1 - (style.tailExt * geom.browLen) / Math.max(1, polylineLength(path))));
    for (let i = extIdx; i < N; i++) {
      const f = 1 - (i - extIdx) / Math.max(1, N - 1 - extIdx);
      hwT[i] = Math.min(hwT[i], 2 + hwT[extIdx] * 0.7 * f);
    }
  }
  smoothArr(hwT);

  // 4) Strokes.
  const strokes = [];
  const rng = mulberry32(seed);
  const spec = style.strokes;
  const count = Math.max(8, Math.round(spec.count * strokeScale * (0.9 + rng() * 0.2)));
  const lenScale = geom.browLen;
  for (let i = 0; i < count; i++) {
    // distribute u; favor gaps (1 - density) when fillWeight is set
    let u = 0.015 + rng() * 0.97;
    if (rng() < spec.fillWeight) {
      // bias toward sparse zones: sample and keep with probability (1-d)
      let tries = 0;
      while (tries++ < 6) {
        const cand = 0.015 + rng() * 0.97;
        const d = geom.density[Math.min(N - 1, Math.floor(cand * (N - 1)))];
        if (rng() < 1 - d) {
          u = cand;
          break;
        }
      }
    }
    const idx = clamp(Math.round(u * (N - 1)), 0, N - 1);
    // skip strokes that land on already-dense hair (keep natural hair visible)
    if (geom.density[idx] > 0.78 && rng() < 0.4) continue;

    const P = path[idx];
    const Tn = tangents[idx];
    const Nn = normalsT[idx];

    // offset across the brow band (triangular distribution, centered)
    const o = (rng() + rng() - 1) * 0.82;
    const base = add(P, scale(Nn, o * hwT[idx]));

    // hair-flow slant: rotate the local tangent toward the eye (down),
    // head least, tail most — matches natural brow hair growth.
    let slantDeg;
    if (u < 0.45) slantDeg = spec.slantHead + ((u / 0.45) * (spec.slantArch - spec.slantHead));
    else slantDeg = spec.slantArch + (((u - 0.45) / 0.55) * (spec.slantTail - spec.slantArch));
    const slantRad = ((slantDeg + (rng() - 0.5) * 14) * Math.PI) / 180;
    const eyeN = v2(-Nn.x, -Nn.y); // toward the eye
    const dir = norm(
      v2(Tn.x * Math.cos(slantRad) + eyeN.x * Math.sin(slantRad), Tn.y * Math.cos(slantRad) + eyeN.y * Math.sin(slantRad))
    );

    const lenFrac = spec.lenRange[0] + rng() * (spec.lenRange[1] - spec.lenRange[0]);
    let len = lenFrac * lenScale * (1.15 - u * 0.5);
    const curv = (spec.curvRange[0] + rng() * (spec.curvRange[1] - spec.curvRange[0])) * (rng() < 0.5 ? -1 : 1) * 0.6;

    let p1 = add(base, scale(dir, len));
    // keep the stroke tip inside the target band
    const over = dist(p1, P) - hwT[idx] * 1.45;
    if (over > 0) len = Math.max(2, len - over * 0.9);
    p1 = add(base, scale(dir, len));
    const ctrl = add(add(base, scale(dir, len * 0.55)), scale(rot90(dir), curv * len * 0.45));

    const wdt = (spec.wdtRange[0] + rng() * (spec.wdtRange[1] - spec.wdtRange[0])) * clamp(hwT[idx] * 0.38, 0.8, 3.2);
    const headFade = style.strokes.headFade && u < 0.16 ? 0.45 + (u / 0.16) * 0.55 : 1;
    const op =
      (spec.opRange[0] + rng() * (spec.opRange[1] - spec.opRange[0])) *
      headFade *
      style.colorProfile.opacity *
      1.7;

    strokes.push({
      x0: base.x,
      y0: base.y,
      cx: ctrl.x,
      cy: ctrl.y,
      x1: p1.x,
      y1: p1.y,
      w: wdt,
      op: clamp(op, 0.05, 0.9),
    });
  }

  return {
    styleId: style.id,
    kind: style.kind,
    centerline: path,
    tangents,
    normals: normalsT,
    halfWidth: hwT,
    strokes,
    eyeCenter: { x: geom.eyeCenterX, y: geom.eyeCenterY },
    powder: style.powder ? { ...style.powder, color: style.colorProfile.base } : null,
    browLen: polylineLength(path),
    debug: {
      natural: center.map((p) => ({ ...p })),
      target: path.map((p) => ({ ...p })),
      controlPointsPx: style.controlPoints.map((c) => {
        const idx = clamp(Math.round(c.u * (N - 1)), 0, N - 1);
        return add(center[idx], scale(normals[idx], -c.dy * style.arch * hw[idx]));
      }),
    },
  };
}

function rotateToward(from, to, maxStep) {
  let d = to - from;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  const step = clamp(d, -maxStep, maxStep);
  return from + step;
}

function smoothArr(arr) {
  for (let pass = 0; pass < 2; pass++) {
    const prev = arr.slice();
    for (let i = 1; i < arr.length - 1; i++) {
      arr[i] = (prev[i - 1] + 2 * prev[i] + prev[i + 1]) / 4;
    }
  }
}
