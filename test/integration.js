#!/usr/bin/env node
// Integration tests — verifies that each catalog service API responds correctly.
//
// Usage:  node test/integration.js
// Requires Node 18+ (native fetch).
//
// Each test fetches the real API, parses the response with the same logic used
// in background.js, and asserts the shape of the result.  Tests run in parallel.

'use strict';

const fs   = require('fs');
const path = require('path');

// ─── Load catalog ──────────────────────────────────────────────────────────────
// new Function wraps the file so `const CATALOG` is accessible via return.
const catalogSrc = fs.readFileSync(path.join(__dirname, '..', 'proxy', 'catalog.js'), 'utf8');
const CATALOG    = Object.entries(new Function(`${catalogSrc}; return CATALOG;`)())
  .map(([id, s]) => ({ id, ...s }));

// ─── Helpers ───────────────────────────────────────────────────────────────────

function timeout(ms) {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`Timed out after ${ms / 1000}s`)), ms)
  );
}

// ─── Fetchers ─────────────────────────────────────────────────────────────────

const { fetchServiceStatus: fetchService } = require('../proxy/fetchers');
const { StatusEnum }    = require('../common/value-objects/status.js');
const { ComponentStatus } = require('../common/value-objects/component-status.js');
const { Incident }  = require('../common/value-objects/incident.js');
const { ServiceStatus }   = require('../common/value-objects/service-status.js');

// ─── Assertions ────────────────────────────────────────────────────────────────

function assertResult(service, result) {
  if (!(result instanceof ServiceStatus))
    throw new Error('result must be a ServiceStatus instance');
  if (typeof result.description !== 'string')
    throw new Error('description must be a string');
  for (const c of result.components) {
    if (!(c instanceof ComponentStatus)) throw new Error(`Component is not a ComponentStatus instance: ${JSON.stringify(c)}`);
  }
  for (const i of result.activeIncidents) {
    if (!(i instanceof Incident)) throw new Error(`Incident is not an Incident instance: ${JSON.stringify(i)}`);
  }
}

// ─── Runner ────────────────────────────────────────────────────────────────────

const TIMEOUT_MS = 15_000;
const C = {
  reset:  '\x1b[0m',
  green:  '\x1b[32m',
  red:    '\x1b[31m',
  yellow: '\x1b[33m',
  dim:    '\x1b[2m',
  bold:   '\x1b[1m',
};

function statusLabel(status, width = 0) {
  const value = status?.value ?? '';
  const text  = (value === 'operational' ? 'ok' : value).padEnd(width);
  switch (value) {
    case 'operational':          return `${C.green}${text}${C.reset}`;
    case 'under_maintenance':    return `${C.yellow}${text}${C.reset}`;
    case 'degraded_performance': return `${C.yellow}${text}${C.reset}`;
    case 'partial_outage':       return `${C.yellow}${text}${C.reset}`;
    case 'major_outage':         return `${C.red}${text}${C.reset}`;
    default:                     return text;
  }
}

async function runAll() {
  console.log(`\n${C.bold}StatusEnum Pages — integration tests${C.reset}`);
  console.log(`${C.dim}${CATALOG.length} services, ${TIMEOUT_MS / 1000}s timeout each, running in parallel${C.reset}\n`);

  const nameW = Math.max(...CATALOG.map(s => s.name.length));
  const typeW = Math.max(...CATALOG.map(s => `[${s.type}]`.length));

  // Run with one automatic retry on network-level failures (e.g. TLS reset under load).
  const run = service =>
    Promise.race([fetchService(service), timeout(TIMEOUT_MS)])
      .catch(err => {
        if (err.cause || err.message === 'fetch failed') {
          return new Promise(res => setTimeout(res, 1500))
            .then(() => Promise.race([fetchService(service), timeout(TIMEOUT_MS)]));
        }
        throw err;
      });

  const jobs     = CATALOG.map(service =>
    run(service)
      .then(result => ({ service, result, error: null }))
      .catch(error => ({ service, result: null, error }))
  );

  const outcomes = await Promise.all(jobs);

  const statusValues = Object.values(StatusEnum).map(s => s.value === 'operational' ? 'ok' : s.value);
  const indW  = Math.max(...statusValues.map(s => s.length));
  const compW = Math.max(...outcomes
    .filter(o => o.result)
    .map(o => `${o.result.components.length} components`.length), 0);

  let passed = 0;
  let failed = 0;

  for (const { service, result, error } of outcomes) {
    const tag    = `[${service.type}]`.padEnd(typeW);
    const label  = service.name.padEnd(nameW);

    if (error) {
      console.log(`${C.red}✗${C.reset} ${label} ${C.dim}${tag}${C.reset}  ${C.red}${error.message}${C.reset}`);
      failed++;
      continue;
    }

    try {
      assertResult(service, result);
      const ind  = statusLabel(result.status, indW);
      const comp = `${result.components.length} components`.padEnd(compW);
      const inc  = result.activeIncidents.length > 0
        ? `  ${C.yellow}${result.activeIncidents.length} active incident(s)${C.reset}`
        : '';
      const desc = result.description ? `  ${C.dim}"${result.description}"${C.reset}` : '';
      console.log(`${C.green}✓${C.reset} ${label} ${C.dim}${tag}${C.reset}  ${ind}  ${C.dim}${comp}${inc}${desc}${C.reset}`);
      passed++;
    } catch (assertErr) {
      console.log(`${C.red}✗${C.reset} ${label} ${C.dim}${tag}${C.reset}  ${C.red}assertion: ${assertErr.message}${C.reset}`);
      failed++;
    }
  }

  console.log(`\n${C.bold}${passed} passed${C.reset}, ${failed > 0 ? C.red : C.dim}${failed} failed${C.reset}\n`);
  process.exit(failed > 0 ? 1 : 0);
}

runAll().catch(err => { console.error(err); process.exit(1); });
