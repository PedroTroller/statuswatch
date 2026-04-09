#!/usr/bin/env node
'use strict';

// Detects the integration type of a status page by trying each fetcher in turn.
// The first fetcher whose validation succeeds determines the type.
// Outputs one of the type strings used in proxy/catalog.js, or "unknown".
//
// Fetchers that require non-derivable config (checkly needs a slug, statusio
// needs a pageId) are not probed and will not be detected.

const {
  fetchStatuspageStatus,
  fetchIncidentioStatus,
  fetchInstatusStatus,
  fetchCachetStatus,
  fetchPagerdutySatus,
  fetchUptimeRobotStatus,
  fetchSite24x7Status,
  fetchSorryappStatus,
  fetchStatuscastStatus,
  fetchHundStatus,
} = require('./proxy/fetchers/index.js');

const url = process.argv[2];

if (!url) {
  process.stderr.write('Usage: detect-integration.js <page-url>\n');
  process.exit(1);
}

const base    = url.replace(/\/$/, '');
const service = { id: 'detect', name: 'detect', statusPageUrl: base, relatedDomains: [], searchAliases: [] };

// statuspage before instatus: both hit /api/v2, but statuspage validates
// status.indicator (an object) which Instatus does not provide.
const PROBES = [
  { type: 'statuspage',  fn: fetchStatuspageStatus  },
  { type: 'incidentio',  fn: fetchIncidentioStatus   },
  { type: 'instatus',    fn: fetchInstatusStatus     },
  { type: 'cachet',      fn: fetchCachetStatus       },
  { type: 'pagerduty',   fn: fetchPagerdutySatus     },
  { type: 'uptimerobot', fn: fetchUptimeRobotStatus  },
  { type: 'site24x7',    fn: fetchSite24x7Status     },
  { type: 'sorryapp',    fn: fetchSorryappStatus     },
  { type: 'statuscast',  fn: fetchStatuscastStatus   },
  { type: 'hund',        fn: fetchHundStatus         },
];

const TIMEOUT_MS = 10_000;

function withTimeout(promise) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS)),
  ]);
}

async function main() {
  for (const { type, fn } of PROBES) {
    try {
      await withTimeout(fn(service));
      process.stdout.write(type + '\n');
      return;
    } catch {
      // fetcher rejected — try next
    }
  }
  process.stdout.write('unknown\n');
}

main();
