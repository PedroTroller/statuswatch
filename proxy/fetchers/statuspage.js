'use strict';

const { Incident }                    = require('../../common/value-objects/incident.js');
const { Component, COMPONENT_STATUSES } = require('../../common/value-objects/component.js');
const { Service }                     = require('../../common/value-objects/service.js');
const { safeJson, _indicatorToStatus, _distributeIncidents } = require('./_helpers.js');

// Maps platform-specific status strings not in our enum to the closest equivalent.
const COMPONENT_STATUS_ALIASES = {
  'full_outage': 'major_outage',
};

function normalizeStatus(s) {
  return COMPONENT_STATUS_ALIASES[s] ?? (COMPONENT_STATUSES.includes(s) ? s : 'degraded_performance');
}

async function fetchStatuspageStatus(service) {
  const [statusRes, componentsRes, incidentsRes] = await Promise.all([
    fetch(`${service.apiBase}/status.json`),
    fetch(`${service.apiBase}/components.json`),
    fetch(`${service.apiBase}/incidents/unresolved.json`),
  ]);

  if (!statusRes.ok)     throw new Error(`Status API returned ${statusRes.status}`);
  if (!componentsRes.ok) throw new Error(`Components API returned ${componentsRes.status}`);

  const statusData     = await safeJson(statusRes);
  const componentsData = await safeJson(componentsRes);
  const incidentsData  = incidentsRes.ok ? await safeJson(incidentsRes) : null;

  if (!statusData?.status?.indicator) throw new Error('Invalid status response');

  const incidents = (incidentsData?.incidents ?? []).map(i => new Incident({
    id:        i.id,
    name:      i.name,
    shortlink: i.shortlink,
    impact:    i.impact,
  }));

  const rawComponents = (componentsData?.components ?? [])
    .filter(c => !c.group_id)
    .map(c => new Component({ id: c.id, name: c.name, status: normalizeStatus(c.status) }));

  const components = _distributeIncidents(rawComponents, incidents,
    _indicatorToStatus(statusData.status.indicator));

  return new Service({
    id:             service.id,
    name:           service.name,
    description:    statusData.status.description ?? '',
    pageUrl:        service.pageUrl,
    relatedDomains: service.relatedDomains ?? [],
    searchAliases:  service.searchAliases  ?? [],
    fetchedAt:      new Date().toISOString(),
    components,
  });
}

// incident.io: same /api/v2/status.json and /api/v2/components.json as
// Statuspage.io, but no /api/v2/incidents/unresolved.json — only
// /api/v2/incidents.json (all incidents). Filter resolved ones client-side.
// Some instances return an HTML page (HTTP 200) for that endpoint — handled
// gracefully by safeJson returning null.
async function fetchIncidentioStatus(service) {
  const [statusRes, componentsRes, incidentsRes] = await Promise.all([
    fetch(`${service.apiBase}/status.json`),
    fetch(`${service.apiBase}/components.json`),
    fetch(`${service.apiBase}/incidents.json`).catch(() => null),
  ]);

  if (!statusRes.ok)     throw new Error(`Status API returned ${statusRes.status}`);
  if (!componentsRes.ok) throw new Error(`Components API returned ${componentsRes.status}`);

  const statusData     = await safeJson(statusRes);
  const componentsData = await safeJson(componentsRes);
  const incidentsData  = incidentsRes?.ok ? await safeJson(incidentsRes) : null;

  if (!statusData?.status?.indicator) throw new Error('Invalid status response');

  const incidents = (incidentsData?.incidents ?? [])
    .filter(i => i.status !== 'resolved')
    .map(i => new Incident({
      id:        i.id,
      name:      i.name,
      shortlink: `${service.pageUrl}/incidents/${i.id}`,
      impact:    i.impact,
    }));

  const rawComponents = (componentsData?.components ?? [])
    .filter(c => !c.group_id)
    .map(c => new Component({ id: c.id, name: c.name, status: normalizeStatus(c.status) }));

  const components = _distributeIncidents(rawComponents, incidents,
    _indicatorToStatus(statusData.status.indicator));

  return new Service({
    id:             service.id,
    name:           service.name,
    description:    statusData.status.description ?? '',
    pageUrl:        service.pageUrl,
    relatedDomains: service.relatedDomains ?? [],
    searchAliases:  service.searchAliases  ?? [],
    fetchedAt:      new Date().toISOString(),
    components,
  });
}

module.exports = { fetchStatuspageStatus, fetchIncidentioStatus };
