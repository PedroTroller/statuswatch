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

// ─── Load catalog & fetchers ──────────────────────────────────────────────────
// catalog.js uses a plain const — wrap it so we can extract the value.
const catalogSrc = fs.readFileSync(path.join(__dirname, 'catalog.js'), 'utf8');
const CATALOG    = new Function(`${catalogSrc}; return CATALOG;`)();

const { fetchServiceStatus } = require('./fetchers.js');

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TIMEOUT_MS  = 20_000;
// Expected refresh interval in seconds.
// GitHub Actions throttles */5 cron schedules to roughly once per hour in practice.
const TTL_SECONDS = 3600;

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
  fs.writeFileSync(file, buf);
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

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const outDir      = path.join(__dirname, 'dist');
  const servicesDir = path.join(outDir, 'services');
  const iconsDir    = path.join(outDir, 'icons');
  fs.mkdirSync(servicesDir, { recursive: true });
  fs.mkdirSync(iconsDir,    { recursive: true });

  const generatedAt = new Date().toISOString();

  // ── services/<id>.json + icons/<id>.png ──────────────────────────────────────
  // Run service fetches and favicon fetches in parallel.
  // Services are fetched first so catalog.json can be enriched with live status.
  console.log(`Fetching ${CATALOG.length} services + icons…`);

  const statusJobs = CATALOG.map(service =>
    fetchWithRetry(service)
      .then(result => ({ service, result }))
      .catch(err   => ({ service, result: {
        indicator:       null,
        description:     '',
        components:      [],
        activeIncidents: [],
        lastFetched:     Date.now(),
        error:           err.message,
      }}))
  );

  const iconJobs = CATALOG.map(service =>
    fetchIconIfNeeded(service, iconsDir)
      .then(iconUrl => ({ id: service.id, iconUrl }))
      .catch(() =>     ({ id: service.id, iconUrl: null }))
  );

  const [outcomes, iconOutcomes] = await Promise.all([
    Promise.all(statusJobs),
    Promise.all(iconJobs),
  ]);

  for (const { service, result } of outcomes) {
    const file = path.join(servicesDir, `${service.id}.json`);
    fs.writeFileSync(file, JSON.stringify({ ...result, generatedAt, ttl: TTL_SECONDS }));
    const ok = result.error ? '✗' : '✓';
    console.log(`  ${ok} ${service.id}`);
  }

  const ok     = outcomes.filter(o => !o.result.error).length;
  const failed = outcomes.filter(o =>  o.result.error).length;
  const iconsOk = iconOutcomes.filter(o => o.iconUrl).length;
  console.log(`\nDone — ${ok} ok, ${failed} failed  |  ${iconsOk}/${CATALOG.length} icons`);

  // ── catalog.json ────────────────────────────────────────────────────────────
  // Written last so each entry can include live indicator, components, and iconUrl.
  // ttl matches the cron interval (5 min) since the catalog carries live data.
  const resultMap = Object.fromEntries(outcomes.map(({ service, result }) => [service.id, result]));
  const iconMap   = Object.fromEntries(iconOutcomes.map(({ id, iconUrl }) => [id, iconUrl]));
  const catalogPayload = {
    generatedAt,
    ttl: TTL_SECONDS,
    services: CATALOG.map(s => publicEntry(s, resultMap[s.id], iconMap[s.id])),
  };
  fs.writeFileSync(
    path.join(outDir, 'catalog.json'),
    JSON.stringify(catalogPayload),
  );
  console.log(`Written → proxy/dist/catalog.json  (${CATALOG.length} services, enriched)`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
