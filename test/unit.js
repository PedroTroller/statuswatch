#!/usr/bin/env node
// test/unit.js — unit tests for proxy/fetchers.js parsing logic.
//
// No network calls — fetch() is intercepted with in-process mock responses.
// Covers status mapping, indicator rollup, filtering, and error paths for
// every platform type.
//
// Usage: node test/unit.js

'use strict';

const assert = require('assert/strict');

const {
  safeJson,
  componentStatusToIndicator,
  fetchStatuspageStatus,
  fetchIncidentioStatus,
  fetchSlackStatus,
  fetchUptimeRobotStatus,
  fetchStatusioStatus,
  fetchGoogleIncidentDashboard,
  fetchZendeskStatus,
  fetchAuth0Status,
  fetchStatuscastStatus,
  fetchPagerdutySatus,   // original export spelling
  fetchAlgoliaStatus,
  fetchHerokuStatus,
  fetchStripeStatus,
  fetchSorryappStatus,
  fetchAwsHealthStatus,
} = require('../proxy/fetchers.js');

// ─── Test runner ──────────────────────────────────────────────────────────────

const TESTS = [];
function test(name, testFunction) { TESTS.push({ name, testFunction }); }

async function run() {
  const COLORS = { reset: '\x1b[0m', green: '\x1b[32m', red: '\x1b[31m', bold: '\x1b[1m', dim: '\x1b[2m' };
  let passed = 0, failed = 0;
  console.log(`\n${COLORS.bold}Status Pages — unit tests${COLORS.reset}\n`);
  for (const { name, testFunction } of TESTS) {
    try {
      await testFunction();
      console.log(`${COLORS.green}✓${COLORS.reset} ${name}`);
      passed++;
    } catch (error) {
      console.error(`${COLORS.red}✗${COLORS.reset} ${name}`);
      console.error(`  ${COLORS.dim}${error.message}${COLORS.reset}`);
      failed++;
    }
  }
  console.log(`\n${COLORS.bold}${passed} passed${COLORS.reset}, ${failed > 0 ? COLORS.red : COLORS.dim}${failed} failed${COLORS.reset}\n`);
  process.exit(failed > 0 ? 1 : 0);
}

// ─── Mock fetch ───────────────────────────────────────────────────────────────

// Sets global.fetch so that fetching any URL returns the response defined in
// the map. Keys are matched exactly first, then by prefix — the prefix match
// handles URLs with dynamic query strings (Zendesk date param, PagerDuty filters).
function mockFetch(map) {
  global.fetch = async (url) => {
    const urlString = String(url);
    let entry = map[urlString];
    if (entry === undefined) {
      for (const key of Object.keys(map)) {
        if (urlString.startsWith(key)) { entry = map[key]; break; }
      }
    }
    if (entry === undefined) throw new Error(`Unexpected fetch: ${urlString}`);
    if (entry instanceof Error) throw entry;
    const { status = 200, body = null, arrayBuffer: rawArrayBuffer = null } = entry;
    return {
      ok:          status >= 200 && status < 300,
      status,
      json:        async () => body,
      text:        async () => (typeof body === 'string' ? body : JSON.stringify(body)),
      arrayBuffer: async () => rawArrayBuffer ?? new ArrayBuffer(0),
    };
  };
}

// Encode a string as UTF-16 BE ArrayBuffer — mirrors the AWS Health response format.
function utf16beEncode(string) {
  const nodeBuffer = Buffer.allocUnsafe(string.length * 2);
  for (let i = 0; i < string.length; i++) nodeBuffer.writeUInt16BE(string.charCodeAt(i), i * 2);
  return nodeBuffer.buffer.slice(nodeBuffer.byteOffset, nodeBuffer.byteOffset + nodeBuffer.byteLength);
}

// ─── Service stubs ────────────────────────────────────────────────────────────

const STATUSPAGE_SERVICE  = { type: 'statuspage',  apiBase: 'https://sp.example.com/api/v2',       pageUrl: 'https://sp.example.com' };
const INCIDENTIO_SERVICE  = { type: 'incidentio',  apiBase: 'https://iio.example.com/api/v2',      pageUrl: 'https://iio.example.com' };
const SLACK_SERVICE       = { type: 'slack',       apiBase: 'https://slack-status.com/api/v1.0.0', pageUrl: 'https://slack-status.com' };
const UPTIMEROBOT_SERVICE = { type: 'uptimerobot', apiBase: 'https://status.example.com/api',      pageUrl: 'https://status.example.com' };
const STATUSIO_SERVICE    = { type: 'statusio',    apiBase: 'https://api.status.io/1.0',            pageUrl: 'https://example.com', pageId: 'abc123' };
const GOOGLE_SERVICE      = { type: 'google',      apiBase: 'https://status.example.com',          pageUrl: 'https://status.example.com' };
const ZENDESK_SERVICE     = { type: 'zendesk',     apiBase: 'https://status.zendesk.com',          pageUrl: 'https://status.zendesk.com' };
const AUTH0_SERVICE       = { type: 'auth0',       apiBase: 'https://status.auth0.com',            pageUrl: 'https://status.auth0.com' };
const STATUSCAST_SERVICE  = { type: 'statuscast',  apiBase: 'https://www.fastlystatus.com',        pageUrl: 'https://www.fastlystatus.com' };
const PAGERDUTY_SERVICE   = { type: 'pagerduty',   apiBase: 'https://status.pagerduty.com',        pageUrl: 'https://status.pagerduty.com' };
const ALGOLIA_SERVICE     = { type: 'algolia',     apiBase: 'https://status.algolia.com',          pageUrl: 'https://status.algolia.com' };
const HEROKU_SERVICE      = { type: 'heroku',      apiBase: 'https://status.heroku.com',           pageUrl: 'https://status.heroku.com' };
const STRIPE_SERVICE      = { type: 'stripe',      apiBase: 'https://status.stripe.com',          pageUrl: 'https://status.stripe.com' };
const SORRYAPP_SERVICE    = { type: 'sorryapp',    apiBase: 'https://status.postmarkapp.com',      pageUrl: 'https://status.postmarkapp.com' };
const AWS_SERVICE         = { type: 'awshealth',   apiBase: 'https://health.aws.amazon.com',       pageUrl: 'https://health.aws.com/health/status' };

// ─── safeJson ─────────────────────────────────────────────────────────────────

test('safeJson: parses valid JSON', async () => {
  const result = await safeJson({ json: async () => ({ ok: true }) });
  assert.deepEqual(result, { ok: true });
});

test('safeJson: returns null on JSON parse error', async () => {
  const result = await safeJson({ json: async () => { throw new SyntaxError('bad json'); } });
  assert.equal(result, null);
});

// ─── componentStatusToIndicator ───────────────────────────────────────────────

test('componentStatusToIndicator: maps all known component statuses', () => {
  assert.equal(componentStatusToIndicator('operational'),          'none');
  assert.equal(componentStatusToIndicator('degraded_performance'), 'minor');
  assert.equal(componentStatusToIndicator('partial_outage'),       'major');
  assert.equal(componentStatusToIndicator('major_outage'),         'critical');
  assert.equal(componentStatusToIndicator('under_maintenance'),    'maintenance');
});

test('componentStatusToIndicator: returns null for unknown status', () => {
  assert.equal(componentStatusToIndicator('some_unknown_value'), null);
});

// ─── fetchStatuspageStatus ────────────────────────────────────────────────────

test('fetchStatuspageStatus: all operational', async () => {
  mockFetch({
    'https://sp.example.com/api/v2/status.json': {
      body: { status: { indicator: 'none', description: 'All Systems Operational' } },
    },
    'https://sp.example.com/api/v2/components.json': {
      body: { components: [
        { id: 'c1', name: 'API',   status: 'operational', group_id: null },
        { id: 'c2', name: 'Sub',   status: 'operational', group_id: 'g1' }, // filtered: child component
        { id: 'g1', name: 'Group', status: 'operational', group_id: null },
      ]},
    },
    'https://sp.example.com/api/v2/incidents/unresolved.json': { body: { incidents: [] } },
  });

  const result = await fetchStatuspageStatus(STATUSPAGE_SERVICE);
  assert.equal(result.indicator, 'none');
  assert.equal(result.components.length, 2);         // Sub (group_id set) filtered out
  assert.equal(result.activeIncidents.length, 0);
  assert.equal(result.error, null);
});

test('fetchStatuspageStatus: active incident surfaced', async () => {
  mockFetch({
    'https://sp.example.com/api/v2/status.json': {
      body: { status: { indicator: 'major', description: 'Partial Outage' } },
    },
    'https://sp.example.com/api/v2/components.json': {
      body: { components: [{ id: 'c1', name: 'API', status: 'partial_outage', group_id: null }] },
    },
    'https://sp.example.com/api/v2/incidents/unresolved.json': {
      body: { incidents: [{ id: 'i1', name: 'API degraded', shortlink: 'https://sp.example.com/i/i1', impact: 'major' }] },
    },
  });

  const result = await fetchStatuspageStatus(STATUSPAGE_SERVICE);
  assert.equal(result.indicator, 'major');
  assert.equal(result.activeIncidents.length, 1);
  assert.equal(result.activeIncidents[0].name, 'API degraded');
});

test('fetchStatuspageStatus: maintenance window → indicator is maintenance', async () => {
  mockFetch({
    'https://sp.example.com/api/v2/status.json': {
      body: { status: { indicator: 'maintenance', description: 'Scheduled Maintenance' } },
    },
    'https://sp.example.com/api/v2/components.json': {
      body: { components: [
        { id: 'c1', name: 'API', status: 'under_maintenance', group_id: null },
      ]},
    },
    'https://sp.example.com/api/v2/incidents/unresolved.json': { body: { incidents: [] } },
  });

  const result = await fetchStatuspageStatus(STATUSPAGE_SERVICE);
  assert.equal(result.indicator, 'maintenance');
  assert.equal(result.components[0].status, 'under_maintenance');
});

test('fetchStatuspageStatus: throws on non-2xx status endpoint', async () => {
  mockFetch({
    'https://sp.example.com/api/v2/status.json':     { status: 503, body: null },
    'https://sp.example.com/api/v2/components.json': { body: { components: [] } },
    'https://sp.example.com/api/v2/incidents/unresolved.json': { body: { incidents: [] } },
  });
  await assert.rejects(() => fetchStatuspageStatus(STATUSPAGE_SERVICE), /Status API returned 503/);
});

// ─── fetchIncidentioStatus ────────────────────────────────────────────────────

test('fetchIncidentioStatus: resolved incidents are filtered out', async () => {
  mockFetch({
    'https://iio.example.com/api/v2/status.json': {
      body: { status: { indicator: 'none', description: 'OK' } },
    },
    'https://iio.example.com/api/v2/components.json': {
      body: { components: [{ id: 'c1', name: 'API', status: 'operational', group_id: null }] },
    },
    'https://iio.example.com/api/v2/incidents.json': {
      body: { incidents: [
        { id: 'i1', name: 'Old incident',    status: 'resolved',      impact: 'minor' },
        { id: 'i2', name: 'Active incident', status: 'investigating', impact: 'major' },
      ]},
    },
  });

  const result = await fetchIncidentioStatus(INCIDENTIO_SERVICE);
  assert.equal(result.activeIncidents.length, 1);
  assert.equal(result.activeIncidents[0].name, 'Active incident');
  assert.equal(result.activeIncidents[0].shortlink, 'https://iio.example.com/incidents/i2');
});

test('fetchIncidentioStatus: missing incidents endpoint is handled gracefully', async () => {
  mockFetch({
    'https://iio.example.com/api/v2/status.json': {
      body: { status: { indicator: 'none', description: 'OK' } },
    },
    'https://iio.example.com/api/v2/components.json': { body: { components: [] } },
    'https://iio.example.com/api/v2/incidents.json':  { status: 404, body: null },
  });

  const result = await fetchIncidentioStatus(INCIDENTIO_SERVICE);
  assert.equal(result.activeIncidents.length, 0);
});

// ─── fetchSlackStatus ─────────────────────────────────────────────────────────

test('fetchSlackStatus: ok → none', async () => {
  mockFetch({ 'https://slack-status.com/api/v1.0.0/current': { body: { status: 'ok' } } });
  const result = await fetchSlackStatus(SLACK_SERVICE);
  assert.equal(result.indicator, 'none');
  assert.equal(result.description, 'All Systems Operational');
});

test('fetchSlackStatus: active → minor', async () => {
  mockFetch({ 'https://slack-status.com/api/v1.0.0/current': { body: { status: 'active' } } });
  const result = await fetchSlackStatus(SLACK_SERVICE);
  assert.equal(result.indicator, 'minor');
});

test('fetchSlackStatus: broken → critical', async () => {
  mockFetch({ 'https://slack-status.com/api/v1.0.0/current': { body: { status: 'broken' } } });
  const result = await fetchSlackStatus(SLACK_SERVICE);
  assert.equal(result.indicator, 'critical');
});

test('fetchSlackStatus: unknown status falls back to minor', async () => {
  mockFetch({ 'https://slack-status.com/api/v1.0.0/current': { body: { status: 'haywire' } } });
  const result = await fetchSlackStatus(SLACK_SERVICE);
  assert.equal(result.indicator, 'minor');
  assert.match(result.description, /haywire/);
});

// ─── fetchUptimeRobotStatus ───────────────────────────────────────────────────

test('fetchUptimeRobotStatus: all up → none', async () => {
  mockFetch({
    'https://status.example.com/api/getMonitorList/x': {
      body: {
        statistics: { counts: { up: 3, down: 0, total: 3 } },
        psp: { monitors: [{ monitorId: 1, name: 'Web', statusClass: 'success' }] },
      },
    },
  });
  const result = await fetchUptimeRobotStatus(UPTIMEROBOT_SERVICE);
  assert.equal(result.indicator, 'none');
  assert.equal(result.components[0].status, 'operational');
});

test('fetchUptimeRobotStatus: some down → major', async () => {
  mockFetch({
    'https://status.example.com/api/getMonitorList/x': {
      body: {
        statistics: { counts: { up: 1, down: 1, total: 2 } },
        psp: { monitors: [
          { monitorId: 1, name: 'Web', statusClass: 'success' },
          { monitorId: 2, name: 'API', statusClass: 'danger' },
        ]},
      },
    },
  });
  const result = await fetchUptimeRobotStatus(UPTIMEROBOT_SERVICE);
  assert.equal(result.indicator, 'major');
  assert.equal(result.components.find(component => component.name === 'API').status, 'major_outage');
});

test('fetchUptimeRobotStatus: all down → critical', async () => {
  mockFetch({
    'https://status.example.com/api/getMonitorList/x': {
      body: { statistics: { counts: { up: 0, down: 2, total: 2 } }, psp: { monitors: [] } },
    },
  });
  const result = await fetchUptimeRobotStatus(UPTIMEROBOT_SERVICE);
  assert.equal(result.indicator, 'critical');
});

test('fetchUptimeRobotStatus: paused monitor → under_maintenance', async () => {
  mockFetch({
    'https://status.example.com/api/getMonitorList/x': {
      body: {
        statistics: { counts: { up: 1, down: 0, total: 2 } },
        psp: { monitors: [{ monitorId: 1, name: 'Maintenance', statusClass: 'black' }] },
      },
    },
  });
  const result = await fetchUptimeRobotStatus(UPTIMEROBOT_SERVICE);
  assert.equal(result.components[0].status, 'under_maintenance');
});

// ─── fetchStatusioStatus ──────────────────────────────────────────────────────

test('fetchStatusioStatus: code 100 → operational / none', async () => {
  mockFetch({
    'https://api.status.io/1.0/status/abc123': {
      body: {
        result: {
          status_overall: { status_code: 100, status: 'Operational' },
          status:    [{ id: 'c1', name: 'API', status_code: 100 }],
          incidents: [],
        },
      },
    },
  });
  const result = await fetchStatusioStatus(STATUSIO_SERVICE);
  assert.equal(result.indicator, 'none');
  assert.equal(result.components[0].status, 'operational');
});

test('fetchStatusioStatus: code 200 → under_maintenance / maintenance', async () => {
  mockFetch({
    'https://api.status.io/1.0/status/abc123': {
      body: {
        result: {
          status_overall: { status_code: 200, status: 'Maintenance' },
          status:    [{ id: 'c1', name: 'API', status_code: 200 }],
          incidents: [],
        },
      },
    },
  });
  const result = await fetchStatusioStatus(STATUSIO_SERVICE);
  assert.equal(result.indicator, 'maintenance');
  assert.equal(result.components[0].status, 'under_maintenance');
});

test('fetchStatusioStatus: code 400 → partial_outage / major', async () => {
  mockFetch({
    'https://api.status.io/1.0/status/abc123': {
      body: {
        result: {
          status_overall: { status_code: 400, status: 'Partial Outage' },
          status:    [{ id: 'c1', name: 'API', status_code: 400 }],
          incidents: [{ id: 'i1', name: 'DB issues' }],
        },
      },
    },
  });
  const result = await fetchStatusioStatus(STATUSIO_SERVICE);
  assert.equal(result.indicator, 'major');
  assert.equal(result.components[0].status, 'partial_outage');
  assert.equal(result.activeIncidents.length, 1);
});

test('fetchStatusioStatus: code 500+ → major_outage / critical', async () => {
  mockFetch({
    'https://api.status.io/1.0/status/abc123': {
      body: {
        result: {
          status_overall: { status_code: 500, status: 'Major Outage' },
          status: [], incidents: [],
        },
      },
    },
  });
  const result = await fetchStatusioStatus(STATUSIO_SERVICE);
  assert.equal(result.indicator, 'critical');
});

// ─── fetchGoogleIncidentDashboard ─────────────────────────────────────────────

test('fetchGoogleIncidentDashboard: ended incidents are ignored', async () => {
  mockFetch({
    'https://status.example.com/incidents.json': {
      body: [{ id: 'old', end: '2024-01-01T00:00:00Z', status_impact: 'SERVICE_OUTAGE', affected_products: [] }],
    },
    'https://status.example.com/products.json': {
      body: { products: [{ id: 'p1', title: 'Gmail' }] },
    },
  });
  const result = await fetchGoogleIncidentDashboard(GOOGLE_SERVICE);
  assert.equal(result.indicator, 'none');
  assert.equal(result.components[0].status, 'operational');
  assert.equal(result.activeIncidents.length, 0);
});

test('fetchGoogleIncidentDashboard: SERVICE_OUTAGE → critical + major_outage component', async () => {
  mockFetch({
    'https://status.example.com/incidents.json': {
      body: [{
        id: 'i1', end: null, status_impact: 'SERVICE_OUTAGE', uri: 'incidents/i1',
        affected_products: [{ id: 'p1', title: 'Gmail' }],
      }],
    },
    'https://status.example.com/products.json': {
      body: { products: [{ id: 'p1', title: 'Gmail' }] },
    },
  });
  const result = await fetchGoogleIncidentDashboard(GOOGLE_SERVICE);
  assert.equal(result.indicator, 'critical');
  assert.equal(result.components.find(component => component.id === 'p1').status, 'major_outage');
  assert.equal(result.activeIncidents.length, 1);
});

test('fetchGoogleIncidentDashboard: worst indicator wins across multiple active incidents', async () => {
  mockFetch({
    'https://status.example.com/incidents.json': {
      body: [
        { id: 'i1', end: null, status_impact: 'SERVICE_INFORMATION', uri: 'i/i1', affected_products: [{ id: 'p1', title: 'A' }] },
        { id: 'i2', end: null, status_impact: 'SERVICE_OUTAGE',      uri: 'i/i2', affected_products: [{ id: 'p2', title: 'B' }] },
      ],
    },
    'https://status.example.com/products.json': {
      body: { products: [{ id: 'p1', title: 'A' }, { id: 'p2', title: 'B' }] },
    },
  });
  const result = await fetchGoogleIncidentDashboard(GOOGLE_SERVICE);
  assert.equal(result.indicator, 'critical');
});

// ─── fetchHerokuStatus ────────────────────────────────────────────────────────

test('fetchHerokuStatus: all green → none / operational', async () => {
  mockFetch({
    'https://status.heroku.com/api/v4/current-status': {
      body: {
        status: [{ system: 'Apps', status: 'green' }, { system: 'Data', status: 'green' }],
        incidents: [],
      },
    },
  });
  const result = await fetchHerokuStatus(HEROKU_SERVICE);
  assert.equal(result.indicator, 'none');
  assert.ok(result.components.every(component => component.status === 'operational'));
});

test('fetchHerokuStatus: yellow system → minor / degraded', async () => {
  mockFetch({
    'https://status.heroku.com/api/v4/current-status': {
      body: { status: [{ system: 'Apps', status: 'yellow' }], incidents: [] },
    },
  });
  const result = await fetchHerokuStatus(HEROKU_SERVICE);
  assert.equal(result.indicator, 'minor');
  assert.equal(result.components[0].status, 'degraded_performance');
});

test('fetchHerokuStatus: red system → critical / major_outage + incident', async () => {
  mockFetch({
    'https://status.heroku.com/api/v4/current-status': {
      body: {
        status: [{ system: 'Apps', status: 'red' }],
        incidents: [{ id: 1, title: 'Dyno outage' }],
      },
    },
  });
  const result = await fetchHerokuStatus(HEROKU_SERVICE);
  assert.equal(result.indicator, 'critical');
  assert.equal(result.components[0].status, 'major_outage');
  assert.equal(result.activeIncidents.length, 1);
});

// ─── fetchStripeStatus ────────────────────────────────────────────────────────

test('fetchStripeStatus: up + null warnings → none / operational', async () => {
  mockFetch({
    'https://status.stripe.com/current/full': {
      body: {
        UptimeStatus: 'up',
        message:      '',
        uptimeData:   [{ key: 'api', title: 'API', warning: null }],
      },
    },
  });
  const result = await fetchStripeStatus(STRIPE_SERVICE);
  assert.equal(result.indicator, 'none');
  assert.equal(result.components[0].status, 'operational');
});

test('fetchStripeStatus: degraded + non-null warning → minor / degraded_performance', async () => {
  mockFetch({
    'https://status.stripe.com/current/full': {
      body: {
        UptimeStatus: 'degraded',
        message:      'Elevated latency',
        uptimeData:   [{ key: 'checkout', title: 'Checkout', warning: 'latency' }],
      },
    },
  });
  const result = await fetchStripeStatus(STRIPE_SERVICE);
  assert.equal(result.indicator, 'minor');
  assert.equal(result.components[0].status, 'degraded_performance');
});

test('fetchStripeStatus: down → critical', async () => {
  mockFetch({
    'https://status.stripe.com/current/full': {
      body: { UptimeStatus: 'down', message: 'Outage', uptimeData: [] },
    },
  });
  const result = await fetchStripeStatus(STRIPE_SERVICE);
  assert.equal(result.indicator, 'critical');
});

// ─── fetchZendeskStatus ───────────────────────────────────────────────────────

test('fetchZendeskStatus: no incidents → none / operational', async () => {
  mockFetch({
    'https://status.zendesk.com/api/ssp/services.json': {
      body: { data: [{ id: '1', attributes: { name: 'Support' } }] },
    },
    'https://status.zendesk.com/api/ssp/incidents.json': {
      body: { data: [], included: [] },
    },
  });
  const result = await fetchZendeskStatus(ZENDESK_SERVICE);
  assert.equal(result.indicator, 'none');
  assert.equal(result.components[0].status, 'operational');
});

test('fetchZendeskStatus: active outage incidentService → critical / major_outage', async () => {
  mockFetch({
    'https://status.zendesk.com/api/ssp/services.json': {
      body: { data: [{ id: '1', attributes: { name: 'Support' } }] },
    },
    'https://status.zendesk.com/api/ssp/incidents.json': {
      body: {
        data: [{ id: 'inc1', attributes: { name: 'Outage', resolvedAt: null, impact: 'major' } }],
        included: [{
          type: 'incidentService',
          attributes: { serviceId: 1, resolvedAt: null, outage: true, degradation: false },
        }],
      },
    },
  });
  const result = await fetchZendeskStatus(ZENDESK_SERVICE);
  assert.equal(result.indicator, 'critical');
  assert.equal(result.components[0].status, 'major_outage');
  assert.equal(result.activeIncidents.length, 1);
});

test('fetchZendeskStatus: resolved incidentService is ignored', async () => {
  mockFetch({
    'https://status.zendesk.com/api/ssp/services.json': {
      body: { data: [{ id: '1', attributes: { name: 'Support' } }] },
    },
    'https://status.zendesk.com/api/ssp/incidents.json': {
      body: {
        data: [],
        included: [{
          type: 'incidentService',
          attributes: { serviceId: 1, resolvedAt: '2024-01-01T00:00:00Z', outage: true },
        }],
      },
    },
  });
  const result = await fetchZendeskStatus(ZENDESK_SERVICE);
  assert.equal(result.indicator, 'none');
  assert.equal(result.components[0].status, 'operational');
});

// ─── fetchStatuscastStatus ────────────────────────────────────────────────────

test('fetchStatuscastStatus: Available + only Level-1 components kept', async () => {
  mockFetch({
    'https://www.fastlystatus.com/status.json': {
      body: { Status: 'Available', StatusText: 'All Systems Operational' },
    },
    'https://www.fastlystatus.com/components.json': {
      body: [
        { id: 1, text: 'CDN',    Level: 1, CurrentStatus: 'Available' },
        { id: 2, text: 'SubCDN', Level: 2, CurrentStatus: 'Available' }, // filtered: Level > 1
      ],
    },
    'https://www.fastlystatus.com/incidents.json': { body: [] },
  });
  const result = await fetchStatuscastStatus(STATUSCAST_SERVICE);
  assert.equal(result.indicator, 'none');
  assert.equal(result.components.length, 1);
  assert.equal(result.components[0].status, 'operational');
});

test('fetchStatuscastStatus: PartialOutage + active InProgress incident', async () => {
  mockFetch({
    'https://www.fastlystatus.com/status.json': {
      body: { Status: 'PartialOutage', StatusText: 'Partial Issues' },
    },
    'https://www.fastlystatus.com/components.json': { body: [] },
    'https://www.fastlystatus.com/incidents.json': {
      body: [
        { Id: 42, Title: 'CDN Issue', Status: 'InProgress', ShortUrl: 'https://s.com/42', IncidentType: 'Outage' },
        { Id: 41, Title: 'Old Issue', Status: 'Resolved',   ShortUrl: null, IncidentType: null }, // filtered
      ],
    },
  });
  const result = await fetchStatuscastStatus(STATUSCAST_SERVICE);
  assert.equal(result.indicator, 'major');
  assert.equal(result.activeIncidents.length, 1);
  assert.equal(result.activeIncidents[0].name, 'CDN Issue');
});

test('fetchStatuscastStatus: Maintenance status → maintenance indicator', async () => {
  mockFetch({
    'https://www.fastlystatus.com/status.json': {
      body: { Status: 'Maintenance', StatusText: 'Maintenance' },
    },
    'https://www.fastlystatus.com/components.json': {
      body: [{ id: 1, text: 'CDN', Level: 1, CurrentStatus: 'Maintenance' }],
    },
    'https://www.fastlystatus.com/incidents.json': { body: [] },
  });
  const result = await fetchStatuscastStatus(STATUSCAST_SERVICE);
  assert.equal(result.indicator, 'maintenance');
  assert.equal(result.components[0].status, 'under_maintenance');
});

// ─── fetchPagerdutySatus ──────────────────────────────────────────────────────

test('fetchPagerdutySatus: inactive services filtered, no posts → none', async () => {
  mockFetch({
    'https://status.pagerduty.com/api/services': {
      body: { services: [
        { id: 's1', display_name: 'Notifications', name: 'n', is_active: true },
        { id: 's2', display_name: 'Deprecated',    name: 'd', is_active: false }, // filtered
      ]},
    },
    'https://status.pagerduty.com/api/posts': { body: { posts: [] } },
  });
  const result = await fetchPagerdutySatus(PAGERDUTY_SERVICE);
  assert.equal(result.indicator, 'none');
  assert.equal(result.components.length, 1);
});

test('fetchPagerdutySatus: major post maps to critical, affected service degraded', async () => {
  mockFetch({
    'https://status.pagerduty.com/api/services': {
      body: { services: [{ id: 's1', display_name: 'Notifications', name: 'n', is_active: true }] },
    },
    'https://status.pagerduty.com/api/posts': {
      body: { posts: [{
        id: 'p1', title: 'Outage',
        current_post_severity_enum: { name: 'major' },
        incident_services: [{ id: 's1' }],
      }]},
    },
  });
  const result = await fetchPagerdutySatus(PAGERDUTY_SERVICE);
  assert.equal(result.indicator, 'critical');   // 'major' maps to 'critical' in PD_SEVERITY_MAP
  assert.equal(result.components[0].status, 'degraded_performance');
  assert.equal(result.activeIncidents.length, 1);
});

test('fetchPagerdutySatus: minor post → minor indicator', async () => {
  mockFetch({
    'https://status.pagerduty.com/api/services': {
      body: { services: [{ id: 's1', display_name: 'API', name: 'a', is_active: true }] },
    },
    'https://status.pagerduty.com/api/posts': {
      body: { posts: [{
        id: 'p1', title: 'Slowdown',
        current_post_severity_enum: { name: 'minor' },
        incident_services: [],
      }]},
    },
  });
  const result = await fetchPagerdutySatus(PAGERDUTY_SERVICE);
  assert.equal(result.indicator, 'minor');
});

// ─── fetchAlgoliaStatus ───────────────────────────────────────────────────────

test('fetchAlgoliaStatus: operational', async () => {
  mockFetch({
    'https://status.algolia.com/3/public/availability': {
      body: { search: { type: 'search', name: 'Search', uptime_days: [{ status: 'operational' }] } },
    },
    'https://status.algolia.com/3/public/incidents': { body: [] },
  });
  const result = await fetchAlgoliaStatus(ALGOLIA_SERVICE);
  assert.equal(result.indicator, 'none');
  assert.equal(result.components[0].status, 'operational');
});

test('fetchAlgoliaStatus: hyphenated status mapped to underscored', async () => {
  mockFetch({
    'https://status.algolia.com/3/public/availability': {
      body: {
        search: { type: 'search', name: 'Search', uptime_days: [{ status: 'degraded-performance' }] },
      },
    },
    'https://status.algolia.com/3/public/incidents': { body: [] },
  });
  const result = await fetchAlgoliaStatus(ALGOLIA_SERVICE);
  assert.equal(result.components[0].status, 'degraded_performance');
});

test('fetchAlgoliaStatus: unresolved incident included', async () => {
  mockFetch({
    'https://status.algolia.com/3/public/availability': {
      body: { search: { type: 'search', name: 'Search', uptime_days: [{ status: 'major-outage' }] } },
    },
    'https://status.algolia.com/3/public/incidents': {
      body: [
        { id: 1, name: 'Outage', resolved_at: null },
        { id: 2, name: 'Old',    resolved_at: '2024-01-01' }, // filtered
      ],
    },
  });
  const result = await fetchAlgoliaStatus(ALGOLIA_SERVICE);
  assert.equal(result.activeIncidents.length, 1);
  assert.equal(result.activeIncidents[0].name, 'Outage');
});

// ─── fetchSorryappStatus ──────────────────────────────────────────────────────

test('fetchSorryappStatus: operational, child components filtered', async () => {
  mockFetch({
    'https://status.postmarkapp.com/api/v1/status': {
      body: { page: { state: 'operational', state_text: 'OK' } },
    },
    'https://status.postmarkapp.com/api/v1/components': {
      body: { components: [
        { id: 1, name: 'SMTP',     state: 'operational', parent_id: null },
        { id: 2, name: 'Sub-SMTP', state: 'operational', parent_id: 1   }, // filtered
      ]},
    },
    'https://status.postmarkapp.com/api/v1/notices': { body: { notices: [] } },
  });
  const result = await fetchSorryappStatus(SORRYAPP_SERVICE);
  assert.equal(result.indicator, 'none');
  assert.equal(result.components.length, 1);
});

test('fetchSorryappStatus: outage state + active notice, ended notice filtered', async () => {
  mockFetch({
    'https://status.postmarkapp.com/api/v1/status': {
      body: { page: { state: 'outage', state_text: 'SMTP down' } },
    },
    'https://status.postmarkapp.com/api/v1/components': { body: { components: [] } },
    'https://status.postmarkapp.com/api/v1/notices': {
      body: { notices: [
        { subject: 'SMTP Issue', url: 'https://s.com/1', ended_at: null },
        { subject: 'Old Issue',  url: 'https://s.com/0', ended_at: '2024-01-01T00:00:00Z' }, // filtered
      ]},
    },
  });
  const result = await fetchSorryappStatus(SORRYAPP_SERVICE);
  assert.equal(result.indicator, 'critical');
  assert.equal(result.activeIncidents.length, 1);
  assert.equal(result.activeIncidents[0].name, 'SMTP Issue');
});

// ─── fetchAuth0Status ─────────────────────────────────────────────────────────

test('fetchAuth0Status: extracts buildId from HTML, returns operational region', async () => {
  mockFetch({
    'https://status.auth0.com': {
      body: '<!DOCTYPE html><script>{"buildId":"build-abc"}</script>',
    },
    'https://status.auth0.com/_next/data/build-abc/index.json': {
      body: {
        pageProps: {
          activeIncidents: [
            { region: 'US-1', environment: 'production', response: { incidents: [] } },
          ],
        },
      },
    },
  });
  const result = await fetchAuth0Status(AUTH0_SERVICE);
  assert.equal(result.indicator, 'none');
  assert.equal(result.components.length, 1);
  assert.equal(result.components[0].name, 'US-1 (production)');
  assert.equal(result.components[0].status, 'operational');
});

test('fetchAuth0Status: major_outage incident in region → critical', async () => {
  mockFetch({
    'https://status.auth0.com': {
      body: '<html>{"buildId":"build-xyz"}</html>',
    },
    'https://status.auth0.com/_next/data/build-xyz/index.json': {
      body: {
        pageProps: {
          activeIncidents: [{
            region: 'EU-1',
            environment: 'production',
            response: {
              incidents: [{ id: 'i1', name: 'Outage', status: 'major_outage', impact: 'critical' }],
            },
          }],
        },
      },
    },
  });
  const result = await fetchAuth0Status(AUTH0_SERVICE);
  assert.equal(result.indicator, 'critical');
  assert.equal(result.components[0].status, 'major_outage');
  assert.equal(result.activeIncidents.length, 1);
});

test('fetchAuth0Status: throws when buildId not found in HTML', async () => {
  mockFetch({ 'https://status.auth0.com': { body: '<html>no build id here</html>' } });
  await assert.rejects(() => fetchAuth0Status(AUTH0_SERVICE), /buildId not found/);
});

// ─── fetchAwsHealthStatus ─────────────────────────────────────────────────────

test('fetchAwsHealthStatus: empty events → none / All Services Operational', async () => {
  mockFetch({
    'https://health.aws.amazon.com/public/currentevents': {
      arrayBuffer: utf16beEncode(JSON.stringify([])),
    },
  });
  const result = await fetchAwsHealthStatus(AWS_SERVICE);
  assert.equal(result.indicator, 'none');
  assert.equal(result.description, 'All Services Operational');
  assert.equal(result.components.length, 0);
});

test('fetchAwsHealthStatus: monitoring events (status 3) → minor', async () => {
  mockFetch({
    'https://health.aws.amazon.com/public/currentevents': {
      arrayBuffer: utf16beEncode(JSON.stringify([
        { status: '3', service: 'EC2', service_name: 'EC2', region_name: 'us-east-1', summary: 'Elevated errors' },
      ])),
    },
  });
  const result = await fetchAwsHealthStatus(AWS_SERVICE);
  assert.equal(result.indicator, 'minor');
  assert.equal(result.components.length, 1);
  assert.equal(result.components[0].status, 'partial_outage');
});

test('fetchAwsHealthStatus: investigating event (status 1) → major', async () => {
  mockFetch({
    'https://health.aws.amazon.com/public/currentevents': {
      arrayBuffer: utf16beEncode(JSON.stringify([
        { status: '1', service: 'EC2', service_name: 'EC2', region_name: 'us-east-1', summary: 'Outage' },
        { status: '3', service: 'S3',  service_name: 'S3',  region_name: 'us-east-1', summary: 'Slow' },
      ])),
    },
  });
  const result = await fetchAwsHealthStatus(AWS_SERVICE);
  assert.equal(result.indicator, 'major');
});

test('fetchAwsHealthStatus: deduplicates components by service+region', async () => {
  mockFetch({
    'https://health.aws.amazon.com/public/currentevents': {
      arrayBuffer: utf16beEncode(JSON.stringify([
        { status: '2', service: 'EC2', service_name: 'EC2', region_name: 'us-east-1', summary: 'Issue 1' },
        { status: '2', service: 'EC2', service_name: 'EC2', region_name: 'us-east-1', summary: 'Issue 2' },
      ])),
    },
  });
  const result = await fetchAwsHealthStatus(AWS_SERVICE);
  assert.equal(result.components.length, 1);       // deduplicated
  assert.equal(result.activeIncidents.length, 2);  // incidents not deduplicated
});

run();
