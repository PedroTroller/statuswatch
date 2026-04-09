#!/usr/bin/env node
// proxy/fetch-all.js — fetches all catalog services and writes:
//
//   proxy/dist/catalog.json          — list of all services (metadata only, no API internals)
//   proxy/dist/services/<id>.json    — one status result file per service
//
// Used by the GitHub Actions workflow to build the status cache served via
// GitHub Pages.
//
// Usage:  node proxy/fetch-all.js
// Requires Node 18+ (native fetch).

'use strict';

const fs   = require('fs');
const path = require('path');
const zlib = require('zlib');

// ─── Load catalog & fetchers ──────────────────────────────────────────────────
// catalog.js uses a plain const — wrap it so we can extract the value.
const catalogSrc = fs.readFileSync(path.join(__dirname, 'catalog.js'), 'utf8');
const CATALOG    = Object.entries(new Function(`${catalogSrc}; return CATALOG;`)())
  .map(([id, s]) => ({ id, ...s }));

const { fetchServiceStatus, componentStatusToIndicator } = require('./fetchers');

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TIMEOUT_MS = 20_000;
// TTL signals to the extension how long to wait before polling again.
// Operational services: 6 minutes. Non-operational/maintenance: 1 minute.
const TTL_OPERATIONAL_S     = 6 * 60;
const TTL_NON_OPERATIONAL_S = 60;

function ttlForResult(result) {
  return (!result.error && result.indicator === 'none') ? TTL_OPERATIONAL_S : TTL_NON_OPERATIONAL_S;
}

function timeout(ms) {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`Timed out after ${ms / 1000}s`)), ms)
  );
}

// One automatic retry on network-level failures (TLS resets under parallel load).
function fetchWithRetry(service) {
  return Promise.race([fetchServiceStatus(service), timeout(TIMEOUT_MS)])
    .catch(err => {
      if (err.cause || err.message === 'fetch failed') {
        return new Promise(res => setTimeout(res, 1500))
          .then(() => Promise.race([fetchServiceStatus(service), timeout(TIMEOUT_MS)]));
      }
      throw err;
    });
}

// Converts a Service value object to the flat format expected by background.js.
// background.js reads: indicator (string), description, components (plain objects),
// activeIncidents (plain objects), lastFetched (timestamp), generatedAt, ttl.
function toDistResult(service) {
  return {
    indicator:       componentStatusToIndicator(service.status.value) ?? 'none',
    description:     service.description,
    components:      service.components.map(c => ({
      id:              c.id,
      name:            c.name,
      status:          c.status,
      activeIncidents: c.activeIncidents.map(i => ({
        id:        i.id,
        name:      i.name,
        shortlink: i.shortlink,
        impact:    i.impact,
      })),
    })),
    activeIncidents: service.activeIncidents.map(i => ({
      id:        i.id,
      name:      i.name,
      shortlink: i.shortlink,
      impact:    i.impact,
    })),
    lastFetched: Date.now(),
  };
}

// ─── PNG resize ───────────────────────────────────────────────────────────────

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
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const len     = Buffer.allocUnsafe(4); len.writeUInt32BE(data.length, 0);
  const crcBuf  = Buffer.allocUnsafe(4); crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

// Resize any PNG buffer to exactly 32×32 using nearest-neighbor sampling.
// Only handles 8-bit RGBA (color type 6) and 8-bit RGB (color type 2),
// which covers all icons returned by Google's favicon CDN.
function resizeTo32(pngBuf) {
  // Parse IHDR — width/height at bytes 16–23, bit depth at 24, color type at 25.
  const srcW     = pngBuf.readUInt32BE(16);
  const srcH     = pngBuf.readUInt32BE(20);
  const bitDepth = pngBuf[24];
  const colorType = pngBuf[25];

  if (srcW === 32 && srcH === 32) return pngBuf;
  if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) return pngBuf;

  const channels = colorType === 6 ? 4 : 3;  // RGBA vs RGB

  // Collect all IDAT chunk data into one buffer, then decompress.
  const idatParts = [];
  let pos = 8;  // skip PNG signature
  while (pos < pngBuf.length - 12) {
    const chunkLen  = pngBuf.readUInt32BE(pos);
    const chunkType = pngBuf.toString('ascii', pos + 4, pos + 8);
    if (chunkType === 'IDAT') idatParts.push(pngBuf.slice(pos + 8, pos + 8 + chunkLen));
    if (chunkType === 'IEND') break;
    pos += 12 + chunkLen;
  }
  const raw = zlib.inflateSync(Buffer.concat(idatParts));

  // Reconstruct pixel rows by un-applying PNG filters.
  const stride  = 1 + srcW * channels;  // filter byte + pixel bytes per row
  const pixels  = Buffer.allocUnsafe(srcH * srcW * channels);
  const prev    = Buffer.alloc(srcW * channels, 0);
  for (let y = 0; y < srcH; y++) {
    const filter = raw[y * stride];
    const row    = raw.slice(y * stride + 1, y * stride + 1 + srcW * channels);
    const out    = pixels.slice(y * srcW * channels);
    const up     = y === 0 ? prev : pixels.slice((y - 1) * srcW * channels);
    for (let i = 0; i < row.length; i++) {
      const a = i >= channels ? out[i - channels] : 0;
      const b = up[i];
      const c = i >= channels ? up[i - channels] : 0;
      switch (filter) {
        case 0: out[i] = row[i]; break;
        case 1: out[i] = (row[i] + a) & 0xFF; break;
        case 2: out[i] = (row[i] + b) & 0xFF; break;
        case 3: out[i] = (row[i] + Math.floor((a + b) / 2)) & 0xFF; break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          out[i] = (row[i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xFF;
          break;
        }
      }
    }
  }

  // Nearest-neighbor scale to 32×32.
  const DST    = 32;
  const dstBuf = Buffer.allocUnsafe(DST * (1 + DST * channels));
  for (let dy = 0; dy < DST; dy++) {
    const sy = Math.floor(dy * srcH / DST);
    dstBuf[dy * (1 + DST * channels)] = 0;  // filter type None
    for (let dx = 0; dx < DST; dx++) {
      const sx  = Math.floor(dx * srcW / DST);
      const src = (sy * srcW + sx) * channels;
      const dst = dy * (1 + DST * channels) + 1 + dx * channels;
      pixels.copy(dstBuf, dst, src, src + channels);
    }
  }

  // Rebuild PNG: signature + IHDR + IDAT + IEND.
  const sig  = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.allocUnsafe(13);
  ihdr.writeUInt32BE(DST, 0); ihdr.writeUInt32BE(DST, 4);
  ihdr[8] = 8; ihdr[9] = colorType; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(dstBuf)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ─── Favicon fetching ─────────────────────────────────────────────────────────

// Primary domain used as the favicon lookup key — mirrors primaryDomain() in popup.js.
function primaryDomain(service) {
  const raw = service.relatedDomains?.[0] ?? new URL(service.pageUrl).host;
  return raw.replace(/^\*\./, '');
}

// Fetch a 32×32 favicon via Google's favicon CDN.
// Returns the PNG buffer, or null on any failure.
async function fetchFavicon(service) {
  const domain = primaryDomain(service);
  const url    = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

// Fetch a favicon only when the cached file is absent (checked before each run
// by the GH Actions cache step that restores dist/icons/).
async function fetchIconIfNeeded(service, iconsDir) {
  const file = path.join(iconsDir, `${service.id}.png`);
  if (fs.existsSync(file)) return `icons/${service.id}.png`;    // cache hit
  const buf = await fetchFavicon(service);
  if (!buf) return null;
  fs.writeFileSync(file, resizeTo32(buf));
  return `icons/${service.id}.png`;
}

// ─── Catalog builder ──────────────────────────────────────────────────────────

// Fields always exposed in catalog.json.  Internal fetcher details (apiBase,
// pageId, type) are omitted — consumers only need what they display or fetch.
const CATALOG_PUBLIC_FIELDS = ['id', 'name', 'pageUrl', 'relatedDomains', 'searchAliases', 'beta'];

// Build a catalog entry, optionally enriched with live status and icon path.
function publicEntry(service, result, iconUrl) {
  const entry = {};
  for (const key of CATALOG_PUBLIC_FIELDS) {
    if (service[key] !== undefined) entry[key] = service[key];
  }
  if (result && !result.error) {
    entry.indicator  = result.indicator;
    entry.components = result.components ?? [];
  }
  if (iconUrl) entry.iconUrl = iconUrl;
  return entry;
}

// ─── Freshness check ──────────────────────────────────────────────────────────

const FRESH_MS = TTL_OPERATIONAL_S * 1000; // 6 minutes — matches operational TTL

// Returns the parsed cached result for a service, or null if absent/unreadable.
function readCached(servicesDir, id) {
  try {
    return JSON.parse(fs.readFileSync(path.join(servicesDir, `${id}.json`), 'utf8'));
  } catch {
    return null;
  }
}

// A cached result is fresh when it has no error, was fully operational, and was fetched within 5 minutes.
// Non-operational or maintenance statuses are always re-fetched regardless of age.
function isFresh(cached) {
  return cached && !cached.error && cached.indicator === 'none' && (Date.now() - cached.lastFetched) < FRESH_MS;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const outDir      = path.join(__dirname, 'dist');
  const servicesDir = path.join(outDir, 'services');
  const iconsDir    = path.join(outDir, 'icons');
  const logsDir     = path.join(outDir, 'logs');
  fs.mkdirSync(servicesDir, { recursive: true });
  fs.mkdirSync(iconsDir,    { recursive: true });
  fs.mkdirSync(logsDir,     { recursive: true });

  const generatedAt = new Date().toISOString();

  // ── services/<id>.json + icons/<id>.png ──────────────────────────────────────
  // Services with a fresh cached result are skipped; all others are fetched.
  // Icons are only downloaded when the file is absent (handled by fetchIconIfNeeded).

  const statusJobs = CATALOG.map(service => {
    const cached = readCached(servicesDir, service.id);
    if (isFresh(cached)) {
      return Promise.resolve({ service, result: cached, skipped: true });
    }
    return fetchWithRetry(service)
      .then(result => ({ service, result: toDistResult(result), skipped: false }))
      .catch(err   => ({ service, skipped: false, result: {
        indicator:       null,
        description:     '',
        components:      [],
        activeIncidents: [],
        lastFetched:     Date.now(),
        error:           err.message,
        errorStack:      err.stack ?? null,
      }}));
  });

  const iconJobs = CATALOG.map(service =>
    fetchIconIfNeeded(service, iconsDir)
      .then(iconUrl => ({ id: service.id, iconUrl }))
      .catch(() =>     ({ id: service.id, iconUrl: null }))
  );

  const [outcomes, iconOutcomes] = await Promise.all([
    Promise.all(statusJobs),
    Promise.all(iconJobs),
  ]);

  for (const { service, result, skipped } of outcomes) {
    if (!skipped) {
      fs.writeFileSync(
        path.join(servicesDir, `${service.id}.json`),
        JSON.stringify({ ...result, generatedAt, ttl: ttlForResult(result) }),
      );
      if (result.error) {
        const header = `[${generatedAt}] [${service.type}] apiBase=${service.apiBase}`;
        const body   = result.errorStack ?? `Error: ${result.error}`;
        fs.appendFileSync(
          path.join(logsDir, `${service.id}.log`),
          `${header}\n${body}\n\n`,
        );
      }
    }
    const mark = skipped ? '↩' : (result.error ? '✗' : '✓');
    console.log(`  ${mark} ${service.id}`);
  }

  const fetched = outcomes.filter(o => !o.skipped).length;
  const skipped = outcomes.filter(o =>  o.skipped).length;
  const failed  = outcomes.filter(o => !o.skipped && o.result.error).length;
  const iconsOk = iconOutcomes.filter(o => o.iconUrl).length;
  console.log(`\nDone — ${fetched} fetched (${failed} failed), ${skipped} skipped  |  ${iconsOk}/${CATALOG.length} icons`);

  // ── catalog.json ────────────────────────────────────────────────────────────
  // Written only when at least one service was re-fetched (success or failure).
  if (fetched > 0) {
    const resultMap = Object.fromEntries(outcomes.map(({ service, result }) => [service.id, result]));
    const iconMap   = Object.fromEntries(iconOutcomes.map(({ id, iconUrl }) => [id, iconUrl]));
    const catalogPayload = {
      generatedAt,
      ttl: TTL_OPERATIONAL_S,
      services: CATALOG.map(s => publicEntry(s, resultMap[s.id], iconMap[s.id])),
    };
    fs.writeFileSync(
      path.join(outDir, 'catalog.json'),
      JSON.stringify(catalogPayload),
    );
    console.log(`Written → proxy/dist/catalog.json  (${CATALOG.length} services, enriched)`);
  }

  // ── index.html ───────────────────────────────────────────────────────────────
  const REPO_URL = 'https://github.com/PedroTroller/statuswatch';
  fs.writeFileSync(path.join(outDir, 'index.html'), `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta http-equiv="refresh" content="0; url=${REPO_URL}">
  <link rel="canonical" href="${REPO_URL}">
  <title>Redirecting…</title>
</head>
<body>
  <script>window.location.replace('${REPO_URL}');</script>
  <a href="${REPO_URL}">${REPO_URL}</a>
</body>
</html>
`);
  console.log('Written → proxy/dist/index.html');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
