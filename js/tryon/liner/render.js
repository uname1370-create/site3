// ---------------------------------------------------------------------------
// liner/render.js — renders the fitted liner: variable-width ribbon along
// the lash curve (70% lid side / 30% lash side) + tapered wing, supersampled
// and blended with multiply + a faint opaque pass.
// ---------------------------------------------------------------------------

import { clamp } from "../lib/vec.js";

/**
 * @param {CanvasRenderingContext2D} ctx result frame
 * @param {object} fitted analyzeLiner() output
 * @param {number} strength user shade 0..1
 */
export function renderLiner(ctx, fitted, strength) {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const { path, normals, width, wing, style } = fitted;
  const n = path.length;

  // Full ribbon polygon: main path + optional wing.
  const line = wing ? path.concat(wing.pts.slice(1)) : path.slice();
  const widths = wing ? width.slice().concat(wing.widths.slice(1)) : width.slice();

  const top = [];
  const bot = [];
  const m = Math.max(6, style.outer * fitted.eyeWidth * 2);
  for (let i = 0; i < line.length; i++) {
    const p = line[i];
    let nm = normals[Math.min(n - 1, i)];
    if (wing && i >= n) {
      // wing normals: perpendicular, keep the "up" side continuous
      const t = { x: line[i].x - line[i - 1].x, y: line[i].y - line[i - 1].y };
      const l = Math.hypot(t.x, t.y) || 1;
      nm = { x: -t.y / l, y: t.x / l };
      if (nm.y > 0) {
        // point the normal upward (away from face) for wing segments
        nm = { x: -nm.x, y: -nm.y };
      }
    }
    const wv = widths[i];
    top.push({ x: p.x + nm.x * wv * 0.72, y: p.y + nm.y * wv * 0.72 });
    bot.push({ x: p.x - nm.x * wv * style.inset, y: p.y - nm.y * wv * style.inset });
  }
  const poly = bot.concat(top.slice().reverse());

  // bbox of ribbon
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of poly) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const x0 = clamp(Math.floor(minX - m), 0, W - 1);
  const y0 = clamp(Math.floor(minY - m), 0, H - 1);
  const w = clamp(Math.ceil(maxX + m - x0), 4, W - x0);
  const h = clamp(Math.ceil(maxY + m - y0), 4, H - y0);

  const ss = style.smoky ? 2 : 2.5;
  const c = document.createElement("canvas");
  c.width = Math.max(2, Math.ceil(w * ss));
  c.height = Math.max(2, Math.ceil(h * ss));
  const g = c.getContext("2d");
  g.setTransform(ss, 0, 0, ss, 0, 0);

  // Pigment gradient along the path (warm dark inner → near-black outer).
  const grad = g.createLinearGradient(path[0].x, path[0].y, path[n - 1].x, path[n - 1].y);
  const alpha = style.alpha * clamp(strength, 0.25, 1.15);
  grad.addColorStop(0, `rgba(58,40,26,${0.55 * alpha})`);
  grad.addColorStop(0.45, `rgba(20,13,9,${0.85 * alpha})`);
  grad.addColorStop(1, `rgba(6,4,2,${0.96 * alpha})`);

  g.fillStyle = grad;
  g.beginPath();
  g.moveTo(poly[0].x, poly[0].y);
  for (let i = 1; i < poly.length; i++) g.lineTo(poly[i].x, poly[i].y);
  g.closePath();
  g.fill();

  // Crisp core line along the lash margin.
  g.strokeStyle = `rgba(8,5,3,${0.8 * alpha})`;
  g.lineWidth = Math.max(0.7, style.core * fitted.eyeWidth * 0.5);
  g.lineCap = "round";
  g.lineJoin = "round";
  g.beginPath();
  g.moveTo(line[0].x, line[0].y);
  for (let i = 1; i < line.length; i++) g.lineTo(line[i].x, line[i].y);
  g.stroke();

  // Smoky: extra soft spread (draw the ribbon again, wider + fainter).
  if (style.smoky) {
    g.globalAlpha = 0.4;
    g.fillStyle = `rgba(24,16,11,${0.5 * alpha})`;
    g.beginPath();
    const wide = poly.map((p, i) => {
      const j = i < top.length ? bot[i] : top[poly.length - 1 - i];
      const ref = line[Math.min(line.length - 1, i < top.length ? i : poly.length - 1 - i)];
      const dx = p.x - ref.x;
      const dy = p.y - ref.y;
      const d = Math.hypot(dx, dy) || 1;
      return { x: p.x + (dx / d) * width[0] * 1.6, y: p.y + (dy / d) * width[0] * 1.6 };
    });
    g.moveTo(wide[0].x, wide[0].y);
    for (let i = 1; i < wide.length; i++) g.lineTo(wide[i].x, wide[i].y);
    g.closePath();
    g.fill();
    g.globalAlpha = 1;
  }

  // Composite: downscale = antialias/soften (Safari-safe, no ctx.filter).
  ctx.save();
  ctx.globalCompositeOperation = "multiply";
  ctx.globalAlpha = clamp(0.55 + 0.4 * alpha, 0, 0.95);
  ctx.drawImage(c, x0, y0, w, h);
  ctx.restore();
  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = clamp(0.10 + 0.12 * alpha, 0, 0.3);
  ctx.drawImage(c, x0, y0, w, h);
  ctx.restore();
}
