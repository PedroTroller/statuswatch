'use strict';

const { Incident }  = require('../../common/value-objects/incident.js');
const { ComponentStatus } = require('../../common/value-objects/component-status.js');
const { ServiceStatus }   = require('../../common/value-objects/service-status.js');
const { safeJson } = require('./_helpers.js');

// PostHog: custom Next.js status page at posthogstatus.com.
// Single endpoint: /api/status — returns overall_status, component_groups,
// standalone_components, active_incidents, active_maintenances.
// Component status strings already match our Status enum values.
// Incidents (both active incidents and maintenances) reference affected components
// via affected_components[].component_id.
async function fetchPosthogStatus(service) {
  const res = await fetch(`${service.statusPageUrl}/api/status`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await safeJson(res);
  if (!data?.overall_status) throw new Error('Invalid PostHog response');

  const allComponents = [
    ...(data.component_groups ?? []).flatMap(g => g.components ?? []),
    ...(data.standalone_components ?? []),
  ];

  const activeIncidentList = [
    ...(data.active_incidents    ?? []),
    ...(data.active_maintenances ?? []),
  ];

  // Build inverted index: component_id → Incident[]
  const incidentsByComponent = {};
  for (const inc of activeIncidentList) {
    const incident = new Incident({
      id:        String(inc.id),
      name:      inc.name,
      url: `${service.statusPageUrl}/incidents/${inc.id}`,
      impact:    inc.status ?? null,
    });
    for (const ac of inc.affected_components ?? []) {
      const cid = String(ac.component_id);
      if (!incidentsByComponent[cid]) incidentsByComponent[cid] = [];
      incidentsByComponent[cid].push(incident);
    }
  }

  const components = allComponents.map(c => new ComponentStatus({
    id:              String(c.id),
    name:            c.name,
    status:          c.status ?? 'operational',
    activeIncidents: incidentsByComponent[String(c.id)] ?? [],
  }));

  const description = data.overall_status === 'operational'
    ? 'All Systems Operational'
    : `${activeIncidentList.length} active incident(s)`;

  return new ServiceStatus({
    id:             service.id,
    name:           service.name,
    description:    description ?? '',
    statusPageUrl:   service.statusPageUrl,
    relatedDomains: service.relatedDomains ?? [],
    searchAliases:  service.searchAliases  ?? [],
    fetchedAt:      new Date().toISOString(),
    components,
  });
}

module.exports = { fetchPosthogStatus };
