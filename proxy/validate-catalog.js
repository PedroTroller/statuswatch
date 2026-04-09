'use strict';

const fs   = require('fs');
const path = require('path');

// Load catalog the same way test/integration.js does.
const catalogSrc = fs.readFileSync(path.join(__dirname, 'catalog.js'), 'utf8');
const CATALOG    = new Function(`${catalogSrc}; return CATALOG;`)();

const REQUIRED_FIELDS = ['id', 'name', 'type', 'pageUrl', 'apiBase'];

const VALID_TYPES = new Set([
  'statuspage',
  'incidentio',
  'slack',
  'uptimerobot',
  'statusio',
  'google',
  'zendesk',
  'auth0',
  'statuscast',
  'pagerduty',
  'algolia',
  'heroku',
  'stripe',
  'sorryapp',
  'awshealth',
]);

const KEBAB_CASE_RE = /^[a-z0-9-]+$/;

const errors  = [];
const seenIds = new Map(); // id -> first index

for (let i = 0; i < CATALOG.length; i++) {
  const entry = CATALOG[i];

  // Use entry id (if present) as the label; fall back to index.
  const label = entry.id != null ? entry.id : `<index ${i}>`;

  // Required fields
  for (const field of REQUIRED_FIELDS) {
    if (entry[field] == null || entry[field] === '') {
      errors.push(`[${label}] missing required field: ${field}`);
    }
  }

  // Only continue with id-specific checks if id is present.
  if (entry.id != null) {
    // Kebab-case
    if (!KEBAB_CASE_RE.test(entry.id)) {
      errors.push(`[${entry.id}] id is not kebab-case (must match /^[a-z0-9-]+$/): "${entry.id}"`);
    }

    // Duplicate id
    if (seenIds.has(entry.id)) {
      errors.push(`[${entry.id}] duplicate id (first seen at index ${seenIds.get(entry.id)}, repeated at index ${i})`);
    } else {
      seenIds.set(entry.id, i);
    }
  }

  // Valid type
  if (entry.type != null && !VALID_TYPES.has(entry.type)) {
    errors.push(`[${label}] unknown type: "${entry.type}"`);
  }
}

if (errors.length === 0) {
  console.log(`✓ ${CATALOG.length} catalog entries valid.`);
  process.exit(0);
} else {
  for (const err of errors) {
    console.error(err);
  }
  console.error(`\n${errors.length} error(s) found in catalog.`);
  process.exit(1);
}
