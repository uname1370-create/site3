// ---------------------------------------------------------------------------
// tools/make-icons.mjs — generates the PWA icon set without any dependencies.
// Hand-rolled PNG encoder (zlib + CRC32) + a procedural brand mark:
// gold 4-point "concave diamond" star + thin gold ring on dark green.
//
// Run: node tools/make-icons.mjs
// Output: icons/icon-192.png, icons/icon-512.png, icons/maskable-512.png,
//         icons/apple-180.png
// ---------------------------------------------------------------------------

import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "..", "icons");

// ---------------- PNG encoder ----------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePNG(size, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

// ---------------- Brand mark ----------------

const BG = [10, 42, 32, 255]; // #0A2A20 dark green
const GOLD = [212, 175, 55, 255]; // #D4AF37
const GOLD_SOFT = [201, 160, 122, 255]; // #C9A07A ring

function starRadius(theta, R, p) {
  // 4-point star: r = R·cos(φ)^p, φ = angular distance from the nearest axis,
  // so the tips sit ON the axes (a diamond) and the waist is at 45°.
  const phi = theta % (Math.PI / 2);
  return R * Math.pow(Math.cos(phi), p);
}

/**
 * @param {number} size output pixels
 * @param {object} o { scale (content scale, ≤1 for maskable safe zone) }
 */
function renderIcon(size, { scale = 1 } = {}) {
  const px = Buffer.alloc(size * size * 4);
  const S = 3; // supersampling
  const c = size / 2;
  const Rstar = size * 0.36 * scale;
  const p = 2.2; // concavity (sharper diamond tips)
  const Rring = size * 0.44 * scale;
  const ringW = Math.max(1, size * 0.014 * scale);
  const Rdot = size * 0.045 * scale;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const dx = x + (sx + 0.5) / S - c;
          const dy = y + (sy + 0.5) / S - c;
          const dist = Math.hypot(dx, dy);
          const theta = Math.atan2(dy, dx);
          let col = BG;
          if (Math.abs(dist - Rring) <= ringW / 2) col = GOLD_SOFT;
          if (dist <= starRadius(theta, Rstar, p)) col = GOLD;
          if (dist <= Rdot) col = GOLD;
          r += col[0];
          g += col[1];
          b += col[2];
        }
      }
      const n = S * S;
      const o = (y * size + x) * 4;
      px[o] = Math.round(r / n);
      px[o + 1] = Math.round(g / n);
      px[o + 2] = Math.round(b / n);
      px[o + 3] = 255;
    }
  }
  return px;
}

mkdirSync(OUT, { recursive: true });
const jobs = [
  ["icon-192.png", 192, 1],
  ["icon-512.png", 512, 1],
  ["maskable-512.png", 512, 0.82], // keep the mark inside the 80% safe zone
  ["apple-180.png", 180, 1],
];
for (const [name, size, scale] of jobs) {
  const png = encodePNG(size, renderIcon(size, { scale }));
  const path = join(OUT, name);
  writeFileSync(path, png);
  console.log(`✓ icons/${name} (${png.length} bytes)`);
}
