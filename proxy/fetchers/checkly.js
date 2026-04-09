'use strict';

const { Incident }  = require('../../common/value-objects/incident.js');
const { ComponentStatus } = require('../../common/value-objects/component-status.js');
const { ServiceStatus }   = require('../../common/value-objects/service-status.js');
const { safeJson, _distributeIncidents } = require('./_helpers.js');

const SEVERITY_TO_STATUS = {
  CRITICAL: 'major_outage',
  MAJOR:    'partial_outage',
  MEDIUM:   'degraded_performance',
  MINOR:    'degraded_performance',
};

const SEVERITY_TO_IMPACT = {
  CRITICAL: 'critical',
  MAJOR:    'major',
  MEDIUM:   'minor',
  MINOR:    'none',
};

const STATUS_RANK = ['operational', 'under_maintenance', 'degraded_performance', 'partial_outage', 'major_outage'];

// Maintenance is signalled by an update entry with status "MAINTENANCE",
// not by the top-level severity field.
function incidentComponentStatus(incident) {
  const updates = incident.incidentUpdates ?? [];
  if (updates.some(u => u.status === 'MAINTENANCE')) return 'under_maintenance';
  return SEVERITY_TO_STATUS[incident.severity] ?? 'degraded_performance';
}

async function fetchChecklyStatus(service) {
  const apiBase = `${service.statusPageUrl}/api/status-page/${service.slug}`;
  const [uptimeRes, incidentsRes] = await Promise.all([
    fetch(`${apiBase}/uptime`),
    fetch(`${apiBase}/unresolved-incidents`),
  ]);

  if (!uptimeRes.ok)    throw new Error(`Checkly uptime API returned ${uptimeRes.status}`);
  if (!incidentsRes.ok) throw new Error(`Checkly incidents API returned ${incidentsRes.status}`);

  const uptimeData    = await safeJson(uptimeRes);
  const incidentsData = await safeJson(incidentsRes);

  if (!Array.isArray(uptimeData?.metadata)) throw new Error('Invalid Checkly uptime response');

  const rawIncidents = incidentsData?.incidents ?? [];

  // Map service ID → worst status across all active incidents.
  const affectedStatus = new Map();
  for (const incident of rawIncidents) {
    const status = incidentComponentStatus(incident);
    for (const svc of (incident.services ?? [])) {
      const current = affectedStatus.get(svc.id);
      if (!current || STATUS_RANK.indexOf(status) > STATUS_RANK.indexOf(current)) {
        affectedStatus.set(svc.id, status);
      }
    }
  }

  const components = uptimeData.metadata.flatMap(group =>
    (group.services ?? []).map(svc => new ComponentStatus({
      id:     svc.id,
      name:   svc.name,
      status: affectedStatus.get(svc.id) ?? 'operational',
    }))
  );

  const incidents = rawIncidents.map(i => new Incident({
    id:        i.id,
    name:      i.name,
    url: `${service.statusPageUrl}/incidents/${i.id}`,
    impact:    SEVERITY_TO_IMPACT[i.severity] ?? null,
  }));

  const description = rawIncidents.length === 0
    ? 'All Systems Operational'
    : rawIncidents[0].name;

  return new ServiceStatus({
    id:             service.id,
    name:           service.name,
    description,
    statusPageUrl:   service.statusPageUrl,
    relatedDomains: service.relatedDomains ?? [],
    searchAliases:  service.searchAliases  ?? [],
    fetchedAt:      new Date().toISOString(),
    components:     _distributeIncidents(components, incidents),
  });
}

module.exports = { fetchChecklyStatus };
