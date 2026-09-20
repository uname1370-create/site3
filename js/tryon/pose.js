// ---------------------------------------------------------------------------
// pose.js — head-pose proxy estimation from 478 landmarks (deterministic,
// calibration-free). Used only for the quality gate, not for geometry.
// ---------------------------------------------------------------------------

import { v2 } from "./lib/vec.js";

const centroidOf = (pts) => {
  const n = pts.length || 1;
  return { x: pts.reduce((s, p) => s + p.x, 0) / n, y: pts.reduce((s, p) => s + p.y, 0) / n };
};

/**
 * @param {object} regions pixel-space regions (see landmarks.js)
 * @returns {{yaw:number, pitch:number, roll:number}} in degrees (signed
 *   proxies: roll is signed left/right; yaw/pitch magnitudes indicate how far
 *   the face is from frontal).
 */
export function estimatePose(regions) {
  const eyeA = centroidOf(regions.sides[0].eyeTop);
  const eyeB = centroidOf(regions.sides[1].eyeTop);
  const eyeMid = v2((eyeA.x + eyeB.x) / 2, (eyeA.y + eyeB.y) / 2);
  const interocular = Math.hypot(eyeB.x - eyeA.x, eyeB.y - eyeA.y) || 1;

  // roll: tilt of the eye-line (degrees; 0 = level)
  const roll = (Math.atan2(eyeB.y - eyeA.y, eyeB.x - eyeA.x) * 180) / Math.PI;

  // yaw proxy: horizontal nose-tip offset from the eye midpoint,
  // normalized by the interocular distance (signed, magnitude-gated).
  const nose = regions.noseTip;
  const yawRatio = clamp1((nose.x - eyeMid.x) / interocular);
  const yaw = (Math.asin(clamp1(yawRatio * 1.8)) * 180) / Math.PI;

  // pitch proxy: eye→nose vs nose→mouth balance (looking up shortens the
  // eye→nose segment; looking down lengthens it).
  const dEyeNose = Math.hypot(nose.x - eyeMid.x, nose.y - eyeMid.y) || 1;
  const mouthMid = v2(
    (regions.mouth.left.x + regions.mouth.right.x) / 2,
    (regions.mouth.left.y + regions.mouth.right.y) / 2
  );
  const dNoseMouth = Math.hypot(mouthMid.x - nose.x, mouthMid.y - nose.y) || 1;
  const ratio = (dEyeNose - dNoseMouth) / (dEyeNose + dNoseMouth);
  const pitch = (Math.asin(clamp1(ratio * 2.4)) * 180) / Math.PI;

  return {
    yaw: Math.max(-90, Math.min(90, yaw)),
    pitch: Math.max(-90, Math.min(90, pitch)),
    roll: Math.max(-90, Math.min(90, roll)),
  };
}

function clamp1(v) {
  return Math.max(-1, Math.min(1, v));
}

/**
 * Gate the pose. `soft` thresholds produce warnings, `hard` failures.
 */
export function poseQuality(pose) {
  const issues = [];
  const blocked = [];
  const abs = { yaw: Math.abs(pose.yaw), pitch: Math.abs(pose.pitch), roll: Math.abs(pose.roll) };

  if (abs.roll > 20) blocked.push("roll");
  else if (abs.roll > 12) issues.push("roll");
  if (abs.yaw > 32) blocked.push("yaw");
  else if (abs.yaw > 20) issues.push("yaw");
  if (abs.pitch > 26) blocked.push("pitch");
  else if (abs.pitch > 16) issues.push("pitch");

  return {
    acceptable: blocked.length === 0,
    warnings: issues,
    blocked,
  };
}
