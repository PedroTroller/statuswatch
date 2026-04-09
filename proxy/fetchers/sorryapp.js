'use strict';

const { Incident }  = require('../../common/value-objects/incident.js');
const { Component } = require('../../common/value-objects/component.js');
const { Service }   = require('../../common/value-objects/service.js');
const { safeJson, _indicatorToStatus, _distributeIncidents } = require('./_helpers.js');

// ── SorryApp ─────────────────────────────────────────────────────────────────
// Used by Postmark and other services on the sorryapp.com platform.
// Endpoints: /api/v1/status, /api/v1/components, /api/v1/notices

const SORRYAPP_PAGE_STATE_MAP = {
  operational: 'none',
  degraded:    'minor',
  outage:      'critical',
  maintenance: 'minor',
};

const SORRYAPP_COMP_STATE_MAP = {
  operational: 'operational',
  degraded:    'degraded_performance',
  outage:      'major_outage',
  maintenance: 'under_maintenance',
};

async function fetchSorryappStatus(service) {
  const base = service.apiBase;
  const [statusRes, compsRes, noticesRes] = await Promise.all([
    fetch(`${base}/api/v1/status`),
    fetch(`${base}/api/v1/components`),
    fetch(`${base}/api/v1/notices`),
  ]);
  if (!statusRes.ok) throw new Error(`HTTP ${statusRes.status}`);
  const [statusData, compsData, noticesData] = await Promise.all([
    safeJson(statusRes),
    safeJson(compsRes),
    safeJson(noticesRes),
  ]);
  if (!statusData?.page) throw new Error('Invalid SorryApp response');

  const indicator   = SORRYAPP_PAGE_STATE_MAP[statusData.page.state] ?? 'major';
  const description = statusData.page.state_text ?? '';

  const incidents = (noticesData?.notices ?? [])
    .filter(n => n.ended_at === null)
    .map(n => new Incident({ name: n.subject, shortlink: n.url }));

  const rawComponents = (compsData?.components ?? [])
    .filter(c => c.parent_id === null)
    .map(c => new Component({
      id:     String(c.id),
      name:   c.name,
      status: SORRYAPP_COMP_STATE_MAP[c.state] ?? 'degraded_performance',
    }));

  const components = _distributeIncidents(rawComponents, incidents, _indicatorToStatus(indicator));
  return new Service({
    id:             service.id,
    name:           service.name,
    description:    description ?? '',
    pageUrl:        service.pageUrl,
    relatedDomains: service.relatedDomains ?? [],
    searchAliases:  service.searchAliases  ?? [],
    fetchedAt:      new Date().toISOString(),
    components,
  });
}

module.exports = { fetchSorryappStatus };
