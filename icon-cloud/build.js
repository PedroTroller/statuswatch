#!/usr/bin/env node
// Generates service-cloud.svg: a grid of 32×32 service icons, 838px wide.
// Icons are read from proxy/dist/icons/ (run node proxy/fetch-all.js first if stale).
// Usage: node icon-cloud/build.js [output.svg]

const fs   = require('fs');
const path = require('path');

const ICON_SIZE = 32;
const GAP       = 8;
const WIDTH     = 838;
const CELL      = ICON_SIZE + GAP;
const COLS      = Math.floor((WIDTH + GAP) / CELL);
const MARGIN_X  = Math.floor((WIDTH - COLS * ICON_SIZE - (COLS - 1) * GAP) / 2);

const ROOT_DIR  = path.join(__dirname, '..');
const ICONS_DIR = path.join(ROOT_DIR, 'proxy', 'dist', 'icons');
const OUTPUT    = process.argv[2] || path.join(__dirname, 'service-cloud.svg');

if (!fs.existsSync(ICONS_DIR)) {
  console.error(`Error: ${ICONS_DIR} not found — run: node proxy/fetch-all.js`);
  process.exit(1);
}

const catalogSrc = fs.readFileSync(path.join(ROOT_DIR, 'proxy', 'catalog.js'), 'utf8');
const CATALOG    = new Function(catalogSrc + '; return CATALOG;')();
const ids        = Object.keys(CATALOG).sort();

const images = [];
let col = 0;
let row = 0;

for (const id of ids) {
  const iconPath = path.join(ICONS_DIR, `${id}.png`);
  if (!fs.existsSync(iconPath)) {
    console.log(`  ✗ ${id} (no local icon — skipped)`);
    continue;
  }
  const b64  = fs.readFileSync(iconPath).toString('base64');
  const name = CATALOG[id].name || id;
  const x    = MARGIN_X + col * CELL;
  const y    = row * CELL;
  images.push(
    `  <image x="${x}" y="${y}" width="${ICON_SIZE}" height="${ICON_SIZE}"` +
    ` href="data:image/png;base64,${b64}"` +
    ` xlink:href="data:image/png;base64,${b64}">` +
    `<title>${name}</title></image>`
  );
  col++;
  if (col >= COLS) { col = 0; row++; }
}

const ROWS   = row + (col > 0 ? 1 : 0);
const HEIGHT = ROWS * ICON_SIZE + (ROWS - 1) * GAP;

const svg = [
  `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"`,
  `     width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">`,
  ...images,
  `</svg>`,
].join('\n');

fs.writeFileSync(OUTPUT, svg);
console.log(`Icons: ${images.length} | ${COLS} cols × ${ROWS} rows | ${WIDTH}×${HEIGHT}px`);
console.log(`Generated: ${OUTPUT}`);
