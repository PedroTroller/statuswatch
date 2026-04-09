// create-icons.js — generates PNG icons using only Node.js built-in modules.
// Run once: node create-icons.js
// Produces: common/icons/icon16.png, icon32.png, icon48.png, icon128.png
//           common/icons/logo.svg  (vector master)
//
// Design: bold white checkmark inside a filled indigo (#6366F1) circle,
// on a transparent background. Anti-aliased edges at all sizes.

const zlib = require('zlib');
const fs   = require('fs');
const path = require('path');

// ── CRC32 ────────────────────────────────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c;
  }
  return t;
})();

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]) & 0xFF];
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// ── PNG chunk ────────────────────────────────────────────────────────────────
function chunk(type, data) {
  const lenBuf  = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf  = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

// ── Encode RGBA pixels → PNG ─────────────────────────────────────────────────
function encodePNG(pixels, size) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(size, 0);
  ihdrData.writeUInt32BE(size, 4);
  ihdrData[8] = 8; ihdrData[9] = 6; // RGBA
  ihdrData[10] = ihdrData[11] = ihdrData[12] = 0;

  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < size; x++) {
      const src = (y * size + x) * 4;
      const dst = row + 1 + x * 4;
      raw[dst]     = pixels[src];
      raw[dst + 1] = pixels[src + 1];
      raw[dst + 2] = pixels[src + 2];
      raw[dst + 3] = pixels[src + 3];
    }
  }

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdrData),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── Geometry helpers ──────────────────────────────────────────────────────────

// Shortest distance from point (px,py) to line segment (x1,y1)→(x2,y2)
function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - x1, py - y1);
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

// ── Draw icon ─────────────────────────────────────────────────────────────────
// Checkmark control points (as fractions of icon size):
//   start  →  corner (bottom of tick)  →  end
const CK = { x1: 0.22, y1: 0.53, xm: 0.42, ym: 0.71, x2: 0.78, y2: 0.29 };

// Indigo fill #6366F1
const [IR, IG, IB] = [99, 102, 241];

function drawIcon(size) {
  const pixels = new Uint8Array(size * size * 4);
  const cx = size / 2;
  const cy = size / 2;
  const outerR    = size / 2 - 1;
  const thickness = Math.max(1.8, size * 0.115); // scales: ~2px@16, ~13px@128

  // Checkmark endpoints in pixel space
  const x1 = CK.x1 * size, y1 = CK.y1 * size;
  const xm = CK.xm * size, ym = CK.ym * size;
  const x2 = CK.x2 * size, y2 = CK.y2 * size;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const idx = (y * size + x) * 4;

      // 1. Anti-aliased circle alpha
      const dist = Math.hypot(px - cx, py - cy);
      const circleA = Math.max(0, Math.min(1, outerR - dist + 0.7));
      if (circleA === 0) continue; // fully outside — leave transparent

      // 2. Anti-aliased checkmark alpha
      const ckDist   = Math.min(
        distToSegment(px, py, x1, y1, xm, ym),
        distToSegment(px, py, xm, ym, x2, y2)
      );
      const checkA = Math.max(0, Math.min(1, thickness / 2 - ckDist + 0.7));

      // 3. Blend white (checkmark) over indigo (circle fill)
      const r = Math.round(255 * checkA + IR * (1 - checkA));
      const g = Math.round(255 * checkA + IG * (1 - checkA));
      const b = Math.round(255 * checkA + IB * (1 - checkA));

      pixels[idx]     = r;
      pixels[idx + 1] = g;
      pixels[idx + 2] = b;
      pixels[idx + 3] = Math.round(circleA * 255);
    }
  }
  return pixels;
}

// ── SVG master logo ───────────────────────────────────────────────────────────
// Matches the PNG design exactly; use this for any web / print usage.
function makeSVG() {
  // Checkmark points in a 128×128 viewport
  const s = 128;
  const x1 = (CK.x1 * s).toFixed(1), y1 = (CK.y1 * s).toFixed(1);
  const xm = (CK.xm * s).toFixed(1), ym = (CK.ym * s).toFixed(1);
  const x2 = (CK.x2 * s).toFixed(1), y2 = (CK.y2 * s).toFixed(1);
  const sw = (s * 0.115).toFixed(1);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${s} ${s}">
  <title>Status Pages</title>
  <circle cx="${s/2}" cy="${s/2}" r="${s/2 - 1}" fill="#6366F1"/>
  <polyline
    points="${x1},${y1} ${xm},${ym} ${x2},${y2}"
    fill="none"
    stroke="white"
    stroke-width="${sw}"
    stroke-linecap="round"
    stroke-linejoin="round"
  />
</svg>`;
}

// ── Main ──────────────────────────────────────────────────────────────────────
const outDir = path.join(__dirname, 'common', 'icons');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

for (const size of [16, 32, 48, 128]) {
  const pixels = drawIcon(size);
  const png    = encodePNG(pixels, size);
  fs.writeFileSync(path.join(outDir, `icon${size}.png`), png);
  console.log(`Created common/icons/icon${size}.png  (${size}×${size})`);
}

const svgPath = path.join(outDir, 'logo.svg');
fs.writeFileSync(svgPath, makeSVG());
console.log('Created common/icons/logo.svg  (vector master)');
