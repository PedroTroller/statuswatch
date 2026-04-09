'use strict';

const fs   = require('fs');
const path = require('path');

const catalogSrc = fs.readFileSync(path.join(__dirname, 'catalog.js'), 'utf8');
const CATALOG    = new Function(`${catalogSrc}; return CATALOG;`)();

const REQUIRED_FIELDS = ['name', 'type', 'pageUrl', 'apiBase'];

const VALID_TYPES = new Set([
  'algolia',
  'auth0',
  'awshealth',
  'cachet',
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
