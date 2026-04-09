'use strict';

const { Incident }  = require('../../common/value-objects/incident.js');
const { ComponentStatus } = require('../../common/value-objects/component-status.js');
const { ServiceStatus }   = require('../../common/value-objects/service-status.js');
const { safeJson, _distributeIncidents } = require('./_helpers.js');

// Zendesk: custom status page with JSON:API endpoints.
//   /api/ssp/services.json                    — top-level service list (components)
//   /api/ssp/incidents.json?as_of_date={date} — incidents + incidentServices (included)
// Active incidents: resolvedAt === null. Active incidentServices: same.
// Component status inferred from active incidentServices (outage/degradation flags).

async function fetchZendeskStatus(service) {
  const today = new Date().toISOString().slice(0, 10);
  const [servicesRes, incidentsRes] = await Promise.all([
    fetch(`${service.statusPageUrl}/api/ssp/services.json`),
    fetch(`${service.statusPageUrl}/api/ssp/incidents.json?as_of_date=${today}`),
  ]);
  if (!servicesRes.ok)   throw new Error(`HTTP ${servicesRes.status}`);
  if (!incidentsRes.ok)  throw new Error(`HTTP ${incidentsRes.status}`);
  const servicesData  = await safeJson(servicesRes);
  const incidentsData = await safeJson(incidentsRes);
  if (!Array.isArray(servicesData?.data)) throw new Error('Invalid Zendesk response');

  // Active incidentServices: resolvedAt === null, grouped by serviceId
  const activeByService = {};
  for (const inc of incidentsData?.included ?? []) {
    if (inc.type !== 'incidentService' || inc.attributes.resolvedAt) continue;
    const sid = String(inc.attributes.serviceId);
    const cur = activeByService[sid];
    const worse = inc.attributes.outage || (!cur?.attributes.outage && inc.attributes.degradation);
    if (!cur || worse) activeByService[sid] = inc;
  }

  const incidents = (incidentsData?.data ?? [])
    .filter(i => !i.attributes.resolvedAt)
    .map(i => new Incident({
      id:        i.id,
      name:      i.attributes.name,
      url: `${service.statusPageUrl}/incidents/${i.id}`,
      impact:    i.attributes.impact ?? null,
    }));

  const rawComponents = servicesData.data.map(s => {
    const inc = activeByService[String(s.id)];
    const status = inc
      ? (inc.attributes.outage ? 'major_outage' : 'degraded_performance')
      : 'operational';
    return new ComponentStatus({ id: String(s.id), name: s.attributes.name, status });
  });

  const components = _distributeIncidents(rawComponents, incidents);
  const hasIssue   = components.some(c => c.status !== 'operational') || incidents.length > 0;
  const description = hasIssue ? `${incidents.length} active incident(s)` : 'All Systems Operational';
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

module.exports = { fetchZendeskStatus };
