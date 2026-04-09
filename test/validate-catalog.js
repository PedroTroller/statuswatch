'use strict';

const fs   = require('fs');
const path = require('path');

const catalogSrc = fs.readFileSync(path.join(__dirname, '../proxy/catalog.js'), 'utf8');
const CATALOG    = new Function(`${catalogSrc}; return CATALOG;`)();

const REQUIRED_FIELDS = ['name', 'type', 'statusPageUrl', 'apiBase'];

const VALID_TYPES = new Set([
  'algolia',
  'auth0',
  'awshealth',
  'cachet',
  'checkly',
  'google',
  'heroku',
  'hund',
  'incidentio',
  'instatus',
  'pagerduty',
  'posthog',
  'signal',
  'site24x7',
  'slack',
  'sorryapp',
  'statuscast',
  'statusio',
  'statuspage',
  'stripe',
  'uptimerobot',
  'zendesk',
]);

const KEBAB_CASE_RE = /^[a-z0-9-]+$/;

const errors = [];

for (const [id, entry] of Object.entries(CATALOG)) {
  // Kebab-case key
  if (!KEBAB_CASE_RE.test(id)) {
    errors.push(`[${id}] key is not kebab-case (must match /^[a-z0-9-]+$/)`);
  }

  // Required fields
  for (const field of REQUIRED_FIELDS) {
    if (entry[field] == null || entry[field] === '') {
      errors.push(`[${id}] missing required field: ${field}`);
    }
  }

  // Valid type
  if (entry.type != null && !VALID_TYPES.has(entry.type)) {
    errors.push(`[${id}] unknown type: "${entry.type}"`);
  }
}

// README platform types table must be sorted by descending service count.
// This ensures the table stays in sync when new services are added to the catalog.
const readmeSrc = fs.readFileSync(path.join(__dirname, '../README.md'), 'utf8');

const countPerType = {};
for (const entry of Object.values(CATALOG)) {
  countPerType[entry.type] = (countPerType[entry.type] || 0) + 1;
}

const tableTypeOrder = [...readmeSrc.matchAll(/^\| `([a-z0-9]+)` \|/gm)]
  .map(m => m[1])
  .filter(t => VALID_TYPES.has(t));

for (let i = 1; i < tableTypeOrder.length; i++) {
  const prev = countPerType[tableTypeOrder[i - 1]] ?? 0;
  const curr = countPerType[tableTypeOrder[i]]     ?? 0;
  if (curr > prev) {
    errors.push(
      `README platform types table: \`${tableTypeOrder[i]}\` (${curr} services) ` +
      `appears after \`${tableTypeOrder[i - 1]}\` (${prev} services) — re-sort by descending count`
    );
  }
}

const count = Object.keys(CATALOG).length;
if (errors.length === 0) {
  console.log(`✓ ${count} catalog entries valid.`);
  process.exit(0);
} else {
  for (const err of errors) {
    console.error(err);
  }
  console.error(`\n${errors.length} error(s) found in catalog.`);
  process.exit(1);
}
