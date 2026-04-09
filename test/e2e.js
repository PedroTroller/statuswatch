#!/usr/bin/env node
// test/e2e.js — end-to-end contract test.
//
// For each service in the catalog that has a dist file, verifies that the
// proxy/dist/services/<id>.json file produced by fetch-all.js has the exact
// shape that background.js's fetchFromCache and pollService logic expect.
//
// Usage:  node test/e2e.js
// Requires a populated proxy/dist/services/ directory (run fetch-all.js first).

'use strict';

const fs   = require('fs');
const path = require('path');

// ─── Globals required by cache-reader.js ─────────────────────────────────────

global.GITHUB_PAGES_BASE = 'https://mock-dist';

const DIST_SERVICES = path.join(__dirname, '..', 'proxy', 'dist', 'services');

// Mock fetch to serve local dist files instead of hitting GitHub Pages.
global.fetch = async function (url) {
  const match = url.match(/\/services\/([^/]+\.json)$/);
  if (!match) return { ok: false, status: 404, json: () => Promise.resolve(null) };
  const filePath = path.join(DIST_SERVICES, match[1]);
  if (!fs.existsSync(filePath)) return { ok: false, status: 404, json: () => Promise.resolve(null) };
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return { ok: true, json: () => Promise.resolve(data) };
};

// ─── Load catalog & background functions ─────────────────────────────────────

const catalogSrc = fs.readFileSync(path.join(__dirname, '..', 'proxy', 'catalog.js'), 'utf8');
const CATALOG    = new Function(`${catalogSrc}; return CATALOG;`)();

const { fetchFromCache, componentStatusToIndicator } = require('../common/cache-reader.js');

// ─── Assertions ───────────────────────────────────────────────────────────────

const VALID_INDICATORS = new Set(['none', 'minor', 'major', 'critical', 'maintenance']);
const VALID_STATUSES   = new Set([
  'operational', 'degraded_performance', 'partial_outage', 'major_outage', 'under_maintenance',
]);

function assertCacheEntry(data) {
  if (typeof data.indicator !== 'string' || !VALID_INDICATORS.has(data.indicator))
    throw new Error(`indicator must be a valid indicator string, got ${JSON.stringify(data.indicator)}`);
  if (typeof data.description !== 'string')
    throw new Error(`description must be a string, got ${JSON.stringify(data.description)}`);
  if (!Array.isArray(data.components))
    throw new Error('components must be an array');
  for (const c of data.components) {
    if (typeof c.id !== 'string' || c.id === '')
      throw new Error(`component.id must be a non-empty string, got ${JSON.stringify(c.id)}`);
    if (typeof c.name !== 'string' || c.name === '')
      throw new Error(`component.name must be a non-empty string, got ${JSON.stringify(c.name)}`);
    if (!VALID_STATUSES.has(c.status))
      throw new Error(`component.status must be a valid status, got ${JSON.stringify(c.status)}`);
    // Ensure componentStatusToIndicator is consistent with the stored status.
    if (componentStatusToIndicator(c.status) === null)
      throw new Error(`componentStatusToIndicator(${JSON.stringify(c.status)}) returned null`);
    if (!Array.isArray(c.activeIncidents))
      throw new Error(`component.activeIncidents must be an array`);
  }
  if (!Array.isArray(data.activeIncidents))
    throw new Error('activeIncidents must be an array');
  if (typeof data.lastFetched !== 'number')
    throw new Error(`lastFetched must be a number timestamp, got ${JSON.stringify(data.lastFetched)}`);
}

// ─── Runner ───────────────────────────────────────────────────────────────────

const C = {
  reset:  '\x1b[0m',
  green:  '\x1b[32m',
  red:    '\x1b[31m',
  yellow: '\x1b[33m',
  dim:    '\x1b[2m',
  bold:   '\x1b[1m',
};

async function runAll() {
  const present = CATALOG.filter(s => fs.existsSync(path.join(DIST_SERVICES, `${s.id}.json`)));
  const missing = CATALOG.filter(s => !fs.existsSync(path.join(DIST_SERVICES, `${s.id}.json`)));

  console.log(`\n${C.bold}Status Pages — end-to-end cache tests${C.reset}`);
  console.log(`${C.dim}${present.length} dist files found, ${missing.length} missing (skipped)${C.reset}\n`);

  if (present.length === 0) {
    console.log(`${C.yellow}No dist files found — run node proxy/fetch-all.js first.${C.reset}\n`);
    process.exit(0);
  }

  const nameW = Math.max(...CATALOG.map(s => s.name.length));
  let passed = 0, failed = 0;

  for (const service of CATALOG) {
    const label    = service.name.padEnd(nameW);
    const distFile = path.join(DIST_SERVICES, `${service.id}.json`);

    if (!fs.existsSync(distFile)) {
      console.log(`${C.yellow}–${C.reset} ${label}  ${C.dim}no dist file${C.reset}`);
      continue;
    }

    try {
      const data = await fetchFromCache(service);
      assertCacheEntry(data);
      const compCount = `${data.components.length} component${data.components.length !== 1 ? 's' : ''}`;
      console.log(`${C.green}✓${C.reset} ${label}  ${C.dim}${data.indicator.padEnd(11)}  ${compCount}${C.reset}`);
      passed++;
    } catch (err) {
      console.log(`${C.red}✗${C.reset} ${label}  ${C.red}${err.message}${C.reset}`);
      failed++;
    }
  }

  console.log(`\n${C.bold}${passed} passed${C.reset}, ${failed > 0 ? C.red : C.dim}${failed} failed${C.reset}\n`);
  process.exit(failed > 0 ? 1 : 0);
}

runAll().catch(err => { console.error(err); process.exit(1); });
