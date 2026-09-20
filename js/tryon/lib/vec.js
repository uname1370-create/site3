// ---------------------------------------------------------------------------
// vec.js — 2D vector math, curve utilities, Delaunay + piecewise-affine warp.
// Pure module: no DOM access. Testable in Node.
// ---------------------------------------------------------------------------

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const v2 = (x = 0, y = 0) => ({ x, y });

export const add = (a, b) => v2(a.x + b.x, a.y + b.y);
export const sub = (a, b) => v2(a.x - b.x, a.y - b.y);
export const scale = (a, s) => v2(a.x * s, a.y * s);
export const len = (a) => Math.hypot(a.x, a.y);
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const norm = (a) => {
  const l = Math.hypot(a.x, a.y) || 1;
  return v2(a.x / l, a.y / l);
};
export const rot90 = (a) => v2(-a.y, a.x);
export const dot = (a, b) => a.x * b.x + a.y * b.y;
export const cross = (a, b) => a.x * b.y - a.y * b.x;
export const fromAngle = (rad) => v2(Math.cos(rad), Math.sin(rad));
export const angleOf = (a) => Math.atan2(a.y, a.x);
export const lerpPt = (a, b, t) => v2(lerp(a.x, b.x, t), lerp(a.y, b.y, t));

/** Deterministic PRNG (mulberry32). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Polylines
// ---------------------------------------------------------------------------

export function polylineLength(pts) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += dist(pts[i - 1], pts[i]);
  return L;
}

/** Arc-length resample of an open polyline into `n` evenly spaced points. */
export function resamplePolyline(pts, n) {
  if (pts.length < 2) return pts.slice();
  const cum = [0];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    total += dist(pts[i - 1], pts[i]);
    cum.push(total);
  }
  if (total <= 1e-9) return Array.from({ length: n }, () => ({ ...pts[0] }));
  const out = [];
  let j = 0;
  for (let k = 0; k < n; k++) {
    const target = (k / (n - 1)) * total;
    while (j < pts.length - 2 && cum[j + 1] < target) j++;
    const seg = cum[j + 1] - cum[j] || 1;
    const t = clamp((target - cum[j]) / seg, 0, 1);
    out.push(lerpPt(pts[j], pts[j + 1], t));
  }
  return out;
}

/** One point (and tangent) at arc-length fraction u of the polyline. */
export function sampleAt(pts, u) {
  if (!pts.length) return { p: v2(), t: v2(1, 0) };
  if (pts.length === 1) return { p: { ...pts[0] }, t: v2(1, 0) };
  const n = pts.length - 1;
  const f = clamp(u, 0, 1) * n;
  const i = Math.min(n - 1, Math.floor(f));
  const t = f - i;
  const p = lerpPt(pts[i], pts[i + 1], t);
  const t0 = norm(sub(pts[i + 1], pts[i]));
  return { p, t: t0 };
}

/** Chaikin corner-cutting smoothing (open polyline). */
export function chaikin(pts, iterations = 2) {
  let out = pts;
  for (let it = 0; it < iterations; it++) {
    const next = [{ ...out[0] }];
    for (let i = 0; i < out.length - 1; i++) {
      const p0 = out[i];
      const p1 = out[i + 1];
      next.push(lerpPt(p0, p1, 0.75));
      next.push(lerpPt(p0, p1, 0.25));
    }
    next.push({ ...out[out.length - 1] });
    out = next;
  }
  return out;
}

/**
 * Catmull-Rom spline through `pts`, sampled `samplesPerSeg` times per segment.
 * Endpoints are mirrored so the curve actually passes through them.
 */
export function catmullRom(pts, samplesPerSeg = 6) {
  if (pts.length < 3) return resamplePolyline(pts, Math.max(2, pts.length));
  const extended = [{ ...pts[0] }, ...pts, { ...pts[pts.length - 1] }];
  const out = [];
  for (let i = 1; i < extended.length - 2; i++) {
    const p0 = extended[i - 1];
    const p1 = extended[i];
    const p2 = extended[i + 1];
    const p3 = extended[i + 2];
    for (let s = 0; s < samplesPerSeg; s++) {
      const t = s / samplesPerSeg;
      const t2 = t * t;
      const t3 = t2 * t;
      out.push({
        x:
          0.5 *
          (2 * p1.x +
            (-p0.x + p2.x) * t +
            (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
            (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y:
          0.5 *
          (2 * p1.y +
            (-p0.y + p2.y) * t +
            (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
            (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
      });
    }
  }
  out.push({ ...pts[pts.length - 1] });
  return out;
}

/**
 * Evaluate a 1-D Catmull-Rom over control points (u_i, val_i) — used for
 * style control-point interpolation (arch lift, width profile, …).
 */
export function catmull1D(ctrl, u) {
  if (!ctrl.length) return 0;
  if (ctrl.length === 1) return ctrl[0].v;
  if (u <= ctrl[0].u) return ctrl[0].v;
  const last = ctrl[ctrl.length - 1];
  if (u >= last.u) return last.v;
  let i = 0;
  while (i < ctrl.length - 2 && u > ctrl[i + 1].u) i++;
  const p0 = ctrl[Math.max(0, i - 1)].v;
  const p1 = ctrl[i].v;
  const p2 = ctrl[i + 1].v;
  const p3 = ctrl[Math.min(ctrl.length - 1, i + 2)].v;
  const x1 = ctrl[i].u;
  const x2 = ctrl[i + 1].u;
  const t = clamp((u - x1) / (x2 - x1 || 1e-6), 0, 1);
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  );
}

// ---------------------------------------------------------------------------
// Point-in-polygon / hulls
// ---------------------------------------------------------------------------

/** Ray-casting point in (convex or simple) polygon. */
export function pointInPoly(pt, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (
      a.y > pt.y !== b.y > pt.y &&
      pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y || 1e-12) + a.x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

/** Andrew monotone-chain convex hull (returns indices). */
export function convexHull(pts) {
  const idx = pts.map((_, i) => i).sort((a, b) => pts[a].x - pts[b].x || pts[a].y - pts[b].y);
  if (idx.length < 3) return idx;
  const crossO = (o, a, b) => cross(sub(a, o), sub(b, o));
  const lower = [];
  for (const i of idx) {
    while (lower.length >= 2 && crossO(pts[lower[lower.length - 2]], pts[lower[lower.length - 1]], pts[i]) <= 0) lower.pop();
    lower.push(i);
  }
  const upper = [];
  for (let k = idx.length - 1; k >= 0; k--) {
    const i = idx[k];
    while (upper.length >= 2 && crossO(pts[upper[upper.length - 2]], pts[upper[upper.length - 1]], pts[i]) <= 0) upper.pop();
    upper.push(i);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

export function bbox(pts) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY, maxX, maxY };
}

// ---------------------------------------------------------------------------
// Delaunay (Bowyer–Watson) + piecewise-affine point mapping
// ---------------------------------------------------------------------------

export function pointInTriangle(p, a, b, c) {
  const d1 = cross(sub(b, a), sub(p, a));
  const d2 = cross(sub(c, b), sub(p, b));
  const d3 = cross(sub(a, c), sub(p, c));
  const hasNeg = d1 < -1e-9 || d2 < -1e-9 || d3 < -1e-9;
  const hasPos = d1 > 1e-9 || d2 > 1e-9 || d3 > 1e-9;
  return !(hasNeg && hasPos);
}

/** Scale-aware float tolerance for cross products. */
function crossEps(pts) {
  let s = 0;
  for (const p of pts) s += Math.abs(p.x) + Math.abs(p.y);
  return 1e-9 * s * s;
}

/** Proper (interior) intersection of two segments. */
function segsCross(a, b, c, d) {
  const eps = crossEps([a, b, c, d]);
  const d1 = cross(sub(c, a), sub(b, a));
  const d2 = cross(sub(d, a), sub(b, a));
  const d3 = cross(sub(a, c), sub(d, c));
  const d4 = cross(sub(b, c), sub(d, c));
  const s1 = (d1 > eps && d2 < -eps) || (d1 < -eps && d2 > eps);
  const s2 = (d3 > eps && d4 < -eps) || (d3 < -eps && d4 > eps);
  return s1 && s2;
}

/** Strict point-in-triangle (boundary and vertices excluded). */
function strictlyInsideTri(p, a, b, c) {
  const eps = crossEps([p, a, b, c]);
  const d1 = cross(sub(b, a), sub(p, a));
  const d2 = cross(sub(c, b), sub(p, b));
  const d3 = cross(sub(a, c), sub(p, c));
  return (d1 > eps && d2 > eps && d3 > eps) || (d1 < -eps && d2 < -eps && d3 < -eps);
}

/**
 * Delaunay triangulation (deterministic, exact for this project's sizes).
 *
 * For ≤ ~40 well-separated points the O(n^3) empty-circumcircle enumeration
 * is both fast and far more robust than incremental cavity algorithms on
 * near-degenerate (cocircular) landmark sets: every triangle whose
 * circumcircle contains no other point is a Delaunay triangle; where the
 * input is degenerate, conflicts are resolved by smaller circumradius.
 *
 * @param {Array<{x:number,y:number}>} points
 * @returns {number[][]} triangles as index triples into `points`
 */
export function delaunay(points) {
  const n = points.length;
  if (n < 3) return [];
  const b = bbox(points);
  const scale2 = Math.max(b.w, b.h, 1) ** 2;
  const candidates = [];
  for (let i = 0; i < n; i++) {
    const A = points[i];
    for (let j = i + 1; j < n; j++) {
      const B = points[j];
      for (let k = j + 1; k < n; k++) {
        const C = points[k];
        const area = (B.x - A.x) * (C.y - A.y) - (B.y - A.y) * (C.x - A.x);
        if (Math.abs(area) < 1e-12 * scale2) continue;
        const d2 = 2 * area;
        const a2 = A.x * A.x + A.y * A.y;
        const b2 = B.x * B.x + B.y * B.y;
        const c2 = C.x * C.x + C.y * C.y;
        const ux = (a2 * (B.y - C.y) + b2 * (C.y - A.y) + c2 * (A.y - B.y)) / d2;
        const uy = (a2 * (C.x - B.x) + b2 * (A.x - C.x) + c2 * (B.x - A.x)) / d2;
        const r2 = (A.x - ux) ** 2 + (A.y - uy) ** 2;
        let empty = true;
        for (let m = 0; m < n; m++) {
          if (m === i || m === j || m === k) continue;
          const P = points[m];
          const dd = (P.x - ux) ** 2 + (P.y - uy) ** 2;
          if (dd < r2 * (1 - 1e-9)) {
            empty = false;
            break;
          }
        }
        if (!empty) continue;
        candidates.push({ tr: [i, j, k], r2 });
      }
    }
  }
  // Deterministic order; smaller circumradius wins on degenerate conflicts.
  candidates.sort((p, q) => p.r2 - q.r2);
  const out = [];
  for (const cand of candidates) {
    const A = [points[cand.tr[0]], points[cand.tr[1]], points[cand.tr[2]]];
    let overlap = false;
    for (const o of out) {
      const shared = cand.tr.filter((v) => o.tr.includes(v)).length;
      if (shared >= 2) continue; // adjacent, share an edge
      const B = [points[o.tr[0]], points[o.tr[1]], points[o.tr[2]]];
      if (A.some((p) => strictlyInsideTri(p, B[0], B[1], B[2]))) {
        overlap = true;
        break;
      }
      if (B.some((p) => strictlyInsideTri(p, A[0], A[1], A[2]))) {
        overlap = true;
        break;
      }
      let crossed = false;
      for (let e1 = 0; e1 < 3 && !crossed; e1++) {
        for (let e2 = 0; e2 < 3; e2++) {
          if (segsCross(A[e1], A[(e1 + 1) % 3], B[e2], B[(e2 + 1) % 3])) {
            crossed = true;
            break;
          }
        }
      }
      if (crossed) {
        overlap = true;
        break;
      }
    }
    if (!overlap) out.push(cand);
  }
  return out.map((c) => c.tr);
}

export function triangleCentroid(points, tr) {
  return v2(
    (points[tr[0]].x + points[tr[1]].x + points[tr[2]].x) / 3,
    (points[tr[0]].y + points[tr[1]].y + points[tr[2]].y) / 3
  );
}

/**
 * Build a piecewise-affine mapper from `src` points to `dst` points.
 * Delaunay on the source; each triangle's affine maps to the destination
 * triangle. Queries outside the source hull use the nearest triangle.
 */
export function buildPiecewiseAffine(src, dst) {
  const tris = delaunay(src);
  const cached = tris.map((tr) => {
    const A = src[tr[0]], B = src[tr[1]], C = src[tr[2]];
    const D = dst[tr[0]], E = dst[tr[1]], F = dst[tr[2]];
    const x1 = B.x - A.x, y1 = B.y - A.y;
    const x2 = C.x - A.x, y2 = C.y - A.y;
    const u1 = E.x - D.x, v1 = E.y - D.y;
    const u2 = F.x - D.x, v2 = F.y - D.y;
    const det = x1 * y2 - x2 * y1;
    const m =
      Math.abs(det) < 1e-12
        ? null
        : {
            m00: (u1 * y2 - u2 * y1) / det,
            m01: (u2 * x1 - u1 * x2) / det,
            m10: (v1 * y2 - v2 * y1) / det,
            m11: (v2 * x1 - v1 * x2) / det,
            ax: A.x,
            ay: A.y,
            dx: D.x,
            dy: D.y,
          };
    return { tr, m, centroid: triangleCentroid(src, tr) };
  });

  function locate(p) {
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < cached.length; i++) {
      const c = cached[i];
      if (pointInTriangle(p, src[c.tr[0]], src[c.tr[1]], src[c.tr[2]])) return c;
      const d = dist(p, c.centroid);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best >= 0 ? cached[best] : null;
  }

  return {
    triangles: tris,
    map(p) {
      const c = locate(p);
      if (!c) return null;
      if (!c.m) return { x: p.x, y: p.y };
      const px = p.x - c.m.ax;
      const py = p.y - c.m.ay;
      return v2(c.m.dx + c.m.m00 * px + c.m.m01 * py, c.m.dy + c.m.m10 * px + c.m.m11 * py);
    },
    mapMany(points) {
      return points.map((p) => {
        const q = this.map(p);
        return q || { x: p.x, y: p.y };
      });
    },
  };
}

/**
 * Non-uniform curve fit: given a reference polyline and per-point vertical
 * offsets, produce a displaced polyline.
 */
export function displaceCurve(pts, offsets) {
  return pts.map((p, i) => {
    const t = tangentAt(pts, i);
    const n = rot90(t);
    return add(p, scale(n, offsets[i]));
  });
}

/** Central-difference tangent at index i of a polyline (unit vector). */
export function tangentAt(pts, i) {
  if (pts.length < 2) return v2(1, 0);
  const a = pts[Math.max(0, i - 1)];
  const b = pts[Math.min(pts.length - 1, i + 1)];
  return norm(sub(b, a));
}

export function normalsOf(pts) {
  return pts.map((p, i) => rot90(tangentAt(pts, i)));
}

/**
 * Nearest point on a polyline: returns { i (segment start), t (0..1), d }.
 */
export function nearestOnPolyline(p, pts) {
  let best = { i: 0, t: 0, d: Infinity, x: pts[0]?.x || 0, y: pts[0]?.y || 0 };
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const l2 = abx * abx + aby * aby || 1e-12;
    let t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / l2;
    t = clamp(t, 0, 1);
    const qx = a.x + abx * t;
    const qy = a.y + aby * t;
    const d = Math.hypot(p.x - qx, p.y - qy);
    if (d < best.d) best = { i, t, d, x: qx, y: qy };
  }
  return best;
}
