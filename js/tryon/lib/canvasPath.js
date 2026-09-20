// ---------------------------------------------------------------------------
// canvasPath.js — smooth canvas path tracing (Catmull-Rom → bezier).
// Thin DOM helper shared by the mask/liner renderers.
// ---------------------------------------------------------------------------

/** Trace a Catmull-Rom smooth path through `pts` (begins the path). */
export function tracePath(ctx, pts, closed) {
  if (!pts || !pts.length) return;
  if (pts.length < 3) {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    if (closed) ctx.closePath();
    return;
  }
  const ext = closed
    ? [pts[pts.length - 1], ...pts, pts[0], pts[1]]
    : [pts[0], ...pts, pts[pts.length - 1]];
  const last = closed ? ext.length - 3 : ext.length - 2;
  ctx.beginPath();
  ctx.moveTo(ext[1].x, ext[1].y);
  for (let i = 1; i < last; i++) {
    const p0 = ext[i - 1];
    const p1 = ext[i];
    const p2 = ext[i + 1];
    const p3 = ext[i + 2];
    ctx.bezierCurveTo(
      p1.x + (p2.x - p0.x) / 6,
      p1.y + (p2.y - p0.y) / 6,
      p2.x - (p3.x - p1.x) / 6,
      p2.y - (p3.y - p1.y) / 6,
      p2.x,
      p2.y
    );
  }
  if (closed) ctx.closePath();
}

/** Smooth a closed polygon into more points (for even masks/curves). */
export function smoothClosedPoly(pts, samples = 4) {
  if (!pts || pts.length < 4) return pts ? pts.map((p) => ({ ...p })) : [];
  const ext = [pts[pts.length - 1], ...pts, pts[0]];
  const out = [];
  for (let i = 1; i < ext.length - 2; i++) {
    const p0 = ext[i - 1];
    const p1 = ext[i];
    const p2 = ext[i + 1];
    const p3 = ext[i + 2];
    for (let s = 0; s < samples; s++) {
      const t = s / samples;
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
  return out;
}
