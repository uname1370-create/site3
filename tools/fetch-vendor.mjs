// ---------------------------------------------------------------------------
// tools/fetch-vendor.mjs — download the MediaPipe assets into vendor/ so the
// site works fully offline from the FIRST visit (no CDN needed).
//
// Run on a machine WITH internet:
//   node tools/fetch-vendor.mjs
//
// The site auto-detects vendor/ at runtime: if vendor/mediapipe/
// face_landmarker.task is served, all assets load from there; otherwise it
// falls back to the CDN automatically.
//
// vendor/ is git-ignored by default (keeps the repo light). To ship the
// self-hosted assets with the repo, delete the ignore line in .gitignore.
// ---------------------------------------------------------------------------

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "..", "vendor", "mediapipe");

const VERSION = "0.10.17";
const FILES = [
  [
    `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}/vision_bundle.mjs`,
    "vision_bundle.mjs",
  ],
  [
    `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}/wasm/vision_wasm_internal.js`,
    join("wasm", "vision_wasm_internal.js"),
  ],
  [
    `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}/wasm/vision_wasm_internal.wasm`,
    join("wasm", "vision_wasm_internal.wasm"),
  ],
  [
    `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}/wasm/vision_wasm_nosimd_internal.js`,
    join("wasm", "vision_wasm_nosimd_internal.js"),
  ],
  [
    `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}/wasm/vision_wasm_nosimd_internal.wasm`,
    join("wasm", "vision_wasm_nosimd_internal.wasm"),
  ],
  [
    "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
    "face_landmarker.task",
  ],
];

mkdirSync(join(OUT, "wasm"), { recursive: true });

let failed = 0;
for (const [url, rel] of FILES) {
  const dest = join(OUT, rel);
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    writeFileSync(dest, buf);
    console.log(`✓ ${rel}  (${(buf.length / 1048576).toFixed(2)} MB)`);
  } catch (e) {
    failed++;
    console.error(`✗ ${rel}: ${e.message}`);
  }
}

if (failed) {
  console.error(`\n${failed} file(s) failed — site will keep using the CDN fallback.`);
  process.exit(1);
}
console.log("\nDone. The site now loads MediaPipe from vendor/ (fully offline).");
