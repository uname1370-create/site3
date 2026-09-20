// ---------------------------------------------------------------------------
// debug/overlay.js — developer overlay (?debug=1): face oval, 478 landmarks,
// brow ROI + detected frame, target fit, warp-style control points, stroke
// control points, lip masks, liner path + ribbon. Rendered on a separate
// transparent canvas over the viewer.
// ---------------------------------------------------------------------------

import { tracePath } from "../lib/canvasPath.js";

export function drawDebugOverlay(ctx, W, H, debug, layers) {
  ctx.clearRect(0, 0, W, H);
  if (!debug) return;
  const { regions, landmarksPx } = debug;

  // Face oval
  if (regions) {
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "rgba(80,140,255,0.9)";
    tracePath(ctx, regions.faceOval, true);
    ctx.stroke();
  }

  // All 478 landmarks
  if (layers.landmarks && landmarksPx) {
    ctx.fillStyle = "rgba(120,220,255,0.55)";
    for (const p of landmarksPx) {
      ctx.fillRect(p.x - 1, p.y - 1, 2, 2);
    }
  }

  // Brows
  if (debug.brows && regions) {
    for (let i = 0; i < 2; i++) {
      const side = regions.sides[i];
      const geom = debug.brows.geoms && debug.brows.geoms[i];
      const fitted = debug.brows.fitteds && debug.brows.fitteds[i];

      if (layers.roi && side) {
        ctx.lineWidth = 1;
        ctx.strokeStyle = "rgba(255,170,60,0.75)";
        tracePath(ctx, side.browROI, true);
        ctx.stroke();
      }
      if (layers.natural && geom) {
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = "rgba(255,90,90,0.9)";
        tracePath(ctx, geom.centerline, false);
        ctx.stroke();
        // width band
        ctx.lineWidth = 2;
        ctx.strokeStyle = "rgba(255,90,90,0.25)";
        ctx.beginPath();
        for (let k = 0; k < geom.centerline.length; k++) {
          const p = geom.centerline[k];
          const nm = geom.normals[k];
          const w = geom.halfWidth[k] * 2;
          const x = p.x + nm.x * w;
          const y = p.y + nm.y * w;
          k === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        for (let k = geom.centerline.length - 1; k >= 0; k--) {
          const p = geom.centerline[k];
          const nm = geom.normals[k];
          const w = geom.halfWidth[k] * 2;
          ctx.lineTo(p.x - nm.x * w, p.y - nm.y * w);
        }
        ctx.closePath();
        ctx.stroke();
      }
      if (layers.target && fitted) {
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = "rgba(90,255,140,0.95)";
        tracePath(ctx, fitted.centerline, false);
        ctx.stroke();
        ctx.fillStyle = "rgba(90,255,140,0.95)";
        for (let k = 0; k < fitted.centerline.length; k += 6) {
          const p = fitted.centerline[k];
          ctx.beginPath();
          ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      if (layers.controlPoints && fitted && fitted.debug) {
        ctx.lineWidth = 1;
        ctx.strokeStyle = "rgba(220,120,255,0.9)";
        tracePath(ctx, fitted.debug.controlPointsPx, false);
        ctx.stroke();
        ctx.fillStyle = "rgba(220,120,255,1)";
        for (const p of fitted.debug.controlPointsPx) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      if (layers.strokes && fitted) {
        ctx.fillStyle = "rgba(255,255,255,0.8)";
        for (const s of fitted.strokes) {
          ctx.fillRect(s.x0 - 0.75, s.y0 - 0.75, 1.5, 1.5);
          ctx.fillRect(s.x1 - 0.75, s.y1 - 0.75, 1.5, 1.5);
        }
      }
    }
  }

  // Lips
  if (debug.lips && regions) {
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "rgba(255,120,180,0.95)";
    tracePath(ctx, regions.lips.outer, true);
    ctx.stroke();
    ctx.strokeStyle = "rgba(255,200,120,0.95)";
    tracePath(ctx, regions.lips.inner, true);
    ctx.stroke();
  }

  // Liner
  if (debug.liners) {
    for (const f of debug.liners.fitteds) {
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = "rgba(80,220,255,0.95)";
      tracePath(ctx, f.path, false);
      ctx.stroke();
      if (f.wing) {
        ctx.strokeStyle = "rgba(255,255,80,0.95)";
        tracePath(ctx, f.wing.pts, false);
        ctx.stroke();
      }
      ctx.fillStyle = "rgba(80,220,255,0.9)";
      for (let i = 0; i < f.path.length; i += 4) {
        const p = f.path[i];
        const nm = f.normals[i];
        const w = f.width[i];
        ctx.beginPath();
        ctx.arc(p.x + nm.x * w, p.y + nm.y * w, 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}

export const DEBUG_LAYERS = {
  landmarks: "نقاط ۴۷۸",
  roi: "ROI ابرو",
  natural: "مرکز خط طبیعی",
  target: "مرکز خط هدف",
  controlPoints: "نقاط کنترل استایل",
  strokes: "کنترل‌پوینت تارها",
};
