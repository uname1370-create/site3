// ---------------------------------------------------------------------------
// landmarks.js — MediaPipe Face Landmarker (478-point) index maps + region
// builders. All geometry is derived from the detected landmarks of the
// specific face — no fixed pixel coordinates anywhere.
//
// Note on "left/right": MediaPipe labels the SUBJECT's left. For a frontal,
// unmirrored photo the subject's left appears on the RIGHT of the image.
// We therefore build per-side regions and assign image sides (L = smaller x)
// geometrically after detection, so rendering never assumes handedness.
// ---------------------------------------------------------------------------

import { convexHull, resamplePolyline, catmullRom, bbox, v2 } from "./lib/vec.js";

export const IDX = {
  NOSE_TIP: 1,
  NOSE_BOTTOM: 2,
  FOREHEAD: 10,
  CHIN: 152,
  MOUTH_LEFT: 61, // subject's left mouth corner
  MOUTH_RIGHT: 291,
  LIP_OUTER: [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 375, 321, 405, 314, 17, 84, 181, 91, 146],
  LIP_INNER: [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308, 324, 318, 402, 317, 14, 87, 178, 88, 95],
  // Subject's LEFT brow bone (10 pts) + eye
  BROW_A_TOP: [70, 63, 105, 66, 107, 55, 65, 52, 53, 46],
  BROW_B_TOP: [330, 296, 334, 293, 336, 285, 295, 282, 283, 276],
  EYE_A_TOP: [33, 246, 161, 160, 159, 158, 157, 173, 133],
  EYE_B_TOP: [263, 466, 388, 387, 386, 385, 384, 398, 362],
  EYE_A_BOTTOM: [33, 7, 163, 144],
  EYE_B_BOTTOM: [263, 249, 390, 373],
  IRIS_A: [473, 474, 475, 476, 477],
  IRIS_B: [468, 469, 470, 471, 472],
  FACE_OVAL: [
    10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379,
    378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127,
    162, 21, 54, 103, 67, 109,
  ],
};

const centroidOf = (pts) => {
  const n = pts.length || 1;
  return {
    x: pts.reduce((s, p) => s + p.x, 0) / n,
    y: pts.reduce((s, p) => s + p.y, 0) / n,
  };
};

function smoothClosed(poly, samples = 24) {
  // Catmull-Rom around a closed loop, sampled evenly.
  if (poly.length < 4) return poly.map((p) => ({ ...p }));
  const ext = [poly[poly.length - 1], ...poly, poly[0], poly[1]];
  const out = [];
  for (let i = 1; i < ext.length - 2; i++) {
    const p0 = ext[i - 1], p1 = ext[i], p2 = ext[i + 1], p3 = ext[i + 2];
    for (let s = 0; s < samples; s++) {
      const t = s / samples;
      const t2 = t * t, t3 = t2 * t;
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

/**
 * Build per-face feature regions from a list of 478 pixel landmarks.
 * @param {Array<{x:number,y:number}>} lm478 pixel-space landmarks
 * @param {{faceWidth?: number}} opts
 * @returns the FaceAnalysis `regions` object (pixel space)
 */
export function buildRegions(lm478, opts = {}) {
  const P = (i) => v2(lm478[i].x, lm478[i].y);
  const polyOf = (indices) => indices.map((i) => P(i));

  const faceOval = polyOf(IDX.FACE_OVAL);
  const faceBounds = bbox(faceOval);
  const faceWidth = opts.faceWidth || faceBounds.w;

  const sidesRaw = [
    {
      browTop: polyOf(IDX.BROW_A_TOP),
      eyeTop: polyOf(IDX.EYE_A_TOP),
      eyeBottom: polyOf(IDX.EYE_A_BOTTOM),
      iris: centroidOf(polyOf(IDX.IRIS_A)),
    },
    {
      browTop: polyOf(IDX.BROW_B_TOP),
      eyeTop: polyOf(IDX.EYE_B_TOP),
      eyeBottom: polyOf(IDX.EYE_B_BOTTOM),
      iris: centroidOf(polyOf(IDX.IRIS_B)),
    },
  ];
  // Assign image sides by x (frontal assumption, safe for the pose-gated range).
  if (centroidOf(sidesRaw[0].browTop).x > centroidOf(sidesRaw[1].browTop).x) {
    const t = sidesRaw[0];
    sidesRaw[0] = sidesRaw[1];
    sidesRaw[1] = t;
  }

  const sides = sidesRaw.map((s) => {
    const browC = centroidOf(s.browTop);
    const eyeC = centroidOf(s.eyeTop);
    const innerCorner = { x: (s.eyeTop[0].x + s.eyeTop[8].x) / 2, y: (s.eyeTop[0].y + s.eyeTop[8].y) / 2 };
    // inner corner is the eye corner nearer the face center line
    const faceCenterX = (P(IDX.MOUTH_LEFT).x + P(IDX.MOUTH_RIGHT).x) / 2;
    const eyeCorners = [s.eyeTop[0], s.eyeTop[8]];
    const inner =
      Math.abs(eyeCorners[0].x - faceCenterX) < Math.abs(eyeCorners[1].x - faceCenterX)
        ? eyeCorners[0]
        : eyeCorners[1];
    const outer = inner === eyeCorners[0] ? eyeCorners[1] : eyeCorners[0];

    // Detection ROI: convex hull of brow bone + lash line, inflated so the
    // natural brow hair (which sits slightly below the brow bone) is covered.
    const roiPts = s.browTop.concat(s.eyeTop, [
      v2(browC.x + (inner.x - browC.x) * 0.35, browC.y),
      v2(browC.x + (outer.x - browC.x) * 1.25, browC.y - (browC.y - eyeC.y) * 0.25),
    ]);
    const hullIdx = convexHull(roiPts);
    const hull = hullIdx.map((i) => roiPts[i]);
    const hC = centroidOf(hull);
    const roi = hull.map((p) => {
      const dx = p.x - hC.x;
      const dy = p.y - hC.y;
      const d = Math.hypot(dx, dy) || 1;
      const inflate = 0.18 * Math.max(faceWidth * 0.16, 18);
      return v2(p.x + (dx / d) * inflate, p.y + (dy / d) * inflate);
    });

    return {
      side: browC.x < faceCenterX ? "L" : "R", // image side
      browTop: resamplePolyline(s.browTop, 24),
      eyeTop: resamplePolyline(s.eyeTop, 24),
      eyeBottom: resamplePolyline(s.eyeBottom, 8),
      irisCenter: s.iris,
      eyeCenter: eyeC,
      innerCorner: v2(inner.x, inner.y),
      outerCorner: v2(outer.x, outer.y),
      eyeWidth: Math.hypot(inner.x - outer.x, inner.y - outer.y) || 1,
      browROI: roi,
    };
  });
  sides[0].side = "L";
  sides[1].side = "R";

  const lipOuter = smoothClosed(polyOf(IDX.LIP_OUTER), 20);
  const lipInner = smoothClosed(polyOf(IDX.LIP_INNER), 20);
  const lipUpper = smoothClosed(
    [P(IDX.LIP_OUTER[0]), P(IDX.LIP_OUTER[1]), P(IDX.LIP_OUTER[2]), P(IDX.LIP_OUTER[3]), P(IDX.LIP_OUTER[4]), P(IDX.LIP_OUTER[5]), P(IDX.LIP_OUTER[6]), P(IDX.LIP_OUTER[7]), P(IDX.LIP_OUTER[8])].map((p) => ({ ...p })),
    6
  );
  const lipCenter = centroidOf(lipOuter);

  return {
    faceOval,
    faceBounds,
    faceWidth,
    sides,
    lips: { outer: lipOuter, inner: lipInner, upper: lipUpper, center: lipCenter },
    noseTip: P(IDX.NOSE_TIP),
    noseBottom: P(IDX.NOSE_BOTTOM),
    chin: P(IDX.CHIN),
    forehead: P(IDX.FOREHEAD),
    mouth: { left: P(IDX.MOUTH_LEFT), right: P(IDX.MOUTH_RIGHT) },
  };
}

/** Scale a regions object (or any point tree) by factor (x,y). */
export function scaleRegions(regions, sx, sy) {
  const s = (p) => (p === undefined ? undefined : { x: p.x * sx, y: p.y * sy });
  const arr = (a) => a.map(s);
  const side = (o) => ({
    side: o.side,
    browTop: arr(o.browTop),
    eyeTop: arr(o.eyeTop),
    eyeBottom: arr(o.eyeBottom),
    irisCenter: s(o.irisCenter),
    eyeCenter: s(o.eyeCenter),
    innerCorner: s(o.innerCorner),
    outerCorner: s(o.outerCorner),
    eyeWidth: o.eyeWidth * sx,
    browROI: arr(o.browROI),
  });
  return {
    faceOval: arr(regions.faceOval),
    faceBounds: {
      x: regions.faceBounds.x * sx,
      y: regions.faceBounds.y * sy,
      w: regions.faceBounds.w * sx,
      h: regions.faceBounds.h * sy,
      maxX: regions.faceBounds.maxX * sx,
      maxY: regions.faceBounds.maxY * sy,
    },
    faceWidth: regions.faceWidth * sx,
    sides: regions.sides.map(side),
    lips: {
      outer: arr(regions.lips.outer),
      inner: arr(regions.lips.inner),
      upper: arr(regions.lips.upper),
      center: s(regions.lips.center),
    },
    noseTip: s(regions.noseTip),
    noseBottom: s(regions.noseBottom),
    chin: s(regions.chin),
    forehead: s(regions.forehead),
    mouth: { left: s(regions.mouth.left), right: s(regions.mouth.right) },
  };
}
