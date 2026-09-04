'use strict';

const { Incident }                    = require('../../common/value-objects/incident.js');
const { ComponentStatus, COMPONENT_STATUSES } = require('../../common/value-objects/component-status.js');
const { ServiceStatus }                     = require('../../common/value-objects/service-status.js');
const { safeJson, jsonWithBody, _describeBody, _describeResponse, _indicatorToStatus, _distributeIncidents } = require('./_helpers.js');

// Maps platform-specific status strings not in our enum to the closest equivalent.
const COMPONENT_STATUS_ALIASES = {
  'full_outage': 'major_outage',
};

function normalizeStatus(s) {
  return COMPONENT_STATUS_ALIASES[s] ?? (COMPONENT_STATUSES.includes(s) ? s : 'degraded_performance');
}

// Builds the component list, standing in a single component carrying the page
// indicator when the platform exposes none. ServiceStatus derives its status
// from the worst of its components, so an empty list would report the service
// as operational whatever the page actually says.
function withFallbackComponent(componentsData, overall) {
  const components = (componentsData?.components ?? [])
    .filter(c => !c.group_id)
    .map(c => new ComponentStatus({ id: c.id, name: c.name, status: normalizeStatus(c.status) }));

  return components.length > 0
    ? components
    : [new ComponentStatus({ id: 'service', name: 'Service', status: overall })];
}

async function fetchStatuspageStatus(service) {
  const statusUrl     = `${service.statusPageUrl}/api/v2/status.json`;
  const componentsUrl = `${service.statusPageUrl}/api/v2/components.json`;

  const [statusRes, componentsRes, incidentsRes] = await Promise.all([
    fetch(statusUrl),
    fetch(componentsUrl),
    fetch(`${service.statusPageUrl}/api/v2/incidents/unresolved.json`),
  ]);

  if (!statusRes.ok) {
    throw new Error(`Status API returned ${statusRes.status} for ${statusUrl} (${await _describeResponse(statusRes)})`);
  }

  const status = await jsonWithBody(statusRes);

  if (!status.data?.status?.indicator) {
    throw new Error(`Invalid status response from ${statusUrl}: no status.indicator (${_describeBody(status)})`);
  }

  const overall = _indicatorToStatus(status.data.status.indicator);

  // A component list is optional: some Statuspage instances answer
  // /api/v2/components.json with 404. That is not fatal, because status.json
  // already carries the authoritative overall indicator.
  const componentsData = componentsRes.ok ? await safeJson(componentsRes) : null;
  const incidentsData  = incidentsRes.ok  ? await safeJson(incidentsRes)  : null;

  const incidents = (incidentsData?.incidents ?? []).map(i => new Incident({
    id:        i.id,
    name:      i.name,
    url:       i.shortlink,
    impact:    i.impact,
  }));

  const components = _distributeIncidents(
    withFallbackComponent(componentsData, overall), incidents, overall);

  return new ServiceStatus({
    id:             service.id,
    name:           service.name,
    description:    status.data.status.description ?? '',
    statusPageUrl:   service.statusPageUrl,
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
  const statusUrl = `${service.statusPageUrl}/api/v2/status.json`;

  const [statusRes, componentsRes, incidentsRes] = await Promise.all([
    fetch(statusUrl),
    fetch(`${service.statusPageUrl}/api/v2/components.json`),
    fetch(`${service.statusPageUrl}/api/v2/incidents.json`).catch(() => null),
  ]);

  if (!statusRes.ok) {
    throw new Error(`Status API returned ${statusRes.status} for ${statusUrl} (${await _describeResponse(statusRes)})`);
  }

  const status = await jsonWithBody(statusRes);

  if (!status.data?.status?.indicator) {
    throw new Error(`Invalid status response from ${statusUrl}: no status.indicator (${_describeBody(status)})`);
  }

  const overall = _indicatorToStatus(status.data.status.indicator);

  // Same as Statuspage: the component list is optional, status.json is not.
  const componentsData = componentsRes.ok  ? await safeJson(componentsRes) : null;
  const incidentsData  = incidentsRes?.ok  ? await safeJson(incidentsRes)  : null;

  const incidents = (incidentsData?.incidents ?? [])
    .filter(i => i.status !== 'resolved')
    .map(i => new Incident({
      id:        i.id,
      name:      i.name,
      url: `${service.statusPageUrl}/incidents/${i.id}`,
      impact:    i.impact,
    }));

  const components = _distributeIncidents(
    withFallbackComponent(componentsData, overall), incidents, overall);

  return new ServiceStatus({
    id:             service.id,
    name:           service.name,
    description:    status.data.status.description ?? '',
    statusPageUrl:   service.statusPageUrl,
    relatedDomains: service.relatedDomains ?? [],
    searchAliases:  service.searchAliases  ?? [],
    fetchedAt:      new Date().toISOString(),
    components,
  });
}

module.exports = { fetchStatuspageStatus, fetchIncidentioStatus };
