'use strict';

const { Incident }  = require('../../common/value-objects/incident.js');
const { ComponentStatus } = require('../../common/value-objects/component-status.js');
const { ServiceStatus }   = require('../../common/value-objects/service-status.js');
const { safeJson, _indicatorToStatus, _distributeIncidents } = require('./_helpers.js');

// status.io numeric status codes → our component status strings.
function _statusCodeToComponentStatus(code) {
  if (code <= 100) return 'operational';
  if (code <= 200) return 'under_maintenance';
  if (code <= 300) return 'degraded_performance';
  if (code <= 400) return 'partial_outage';
  return 'major_outage';
}

// status.io numeric status codes → our indicator scale.
function _statusCodeToIndicator(code) {
  if (code <= 100) return 'none';
  if (code <= 200) return 'maintenance'; // scheduled maintenance
  if (code <= 300) return 'minor';       // degraded (300)
  if (code <= 400) return 'major';       // partial outage (400)
  return 'critical';                     // major (500) or critical (600)
}

// status.io: single endpoint at api.status.io/1.0/status/{pageId}.
// The API host is fixed across all status.io pages; pageId is on the catalog entry.
async function fetchStatusioStatus(service) {
  const res = await fetch(`https://api.status.io/1.0/status/${service.pageId}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await safeJson(res);
  if (!data?.result?.status_overall) throw new Error('Invalid status.io response');

  const { status_overall, status: comps, incidents } = data.result;

  const rawComponents = (comps ?? []).map(c => new ComponentStatus({
    id:     c.id,
    name:   c.name,
    status: _statusCodeToComponentStatus(c.status_code),
  }));

  const incidentObjs = (incidents ?? []).map(i => new Incident({
    id:        i.id,
    name:      i.name,
    url: `${service.statusPageUrl}/incidents/${i.id}`,
    impact:    null,
  }));

  const fallback = _indicatorToStatus(_statusCodeToIndicator(status_overall.status_code));
  const components = _distributeIncidents(rawComponents, incidentObjs, fallback);

  return new ServiceStatus({
    id:             service.id,
    name:           service.name,
    description:    status_overall.status ?? '',
    statusPageUrl:   service.statusPageUrl,
    relatedDomains: service.relatedDomains ?? [],
    searchAliases:  service.searchAliases  ?? [],
    fetchedAt:      new Date().toISOString(),
    components,
  });
}

module.exports = { fetchStatusioStatus };
