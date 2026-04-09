'use strict';

const { Incident }  = require('../../common/value-objects/incident.js');
const { Component } = require('../../common/value-objects/component.js');
const { Service }   = require('../../common/value-objects/service.js');
const { safeJson, _distributeIncidents } = require('./_helpers.js');

// Cachet component status integers:
//   1 → operational, 2 → degraded_performance, 3 → partial_outage,
//   4 → major_outage, 5 → under_maintenance
const COMPONENT_STATUS_MAP = {
  1: 'operational',
  2: 'degraded_performance',
  3: 'partial_outage',
  4: 'major_outage',
  5: 'under_maintenance',
};

// Cachet v2+ returns status as { value: "1" }; older deployments return a plain integer.
function parseComponentStatus(raw) {
  const n = typeof raw === 'object' ? parseInt(raw?.value, 10) : Number(raw);
  return COMPONENT_STATUS_MAP[n] ?? 'degraded_performance';
}

async function fetchCachetStatus(service) {
  const [componentsRes, incidentsRes] = await Promise.all([
    fetch(`${service.apiBase}/components?per_page=100`),
    fetch(`${service.apiBase}/incidents?per_page=20&sort=-id`),
  ]);

  if (!componentsRes.ok) throw new Error(`Components API returned ${componentsRes.status}`);

  const componentsData = await safeJson(componentsRes);
  const incidentsData  = incidentsRes.ok ? await safeJson(incidentsRes) : null;

  if (!Array.isArray(componentsData?.data)) throw new Error('Invalid Cachet components response');

  const incidents = (incidentsData?.data ?? [])
    .filter(i => {
      const raw    = i.attributes?.status;
      const status = typeof raw === 'object' ? parseInt(raw?.value, 10) : Number(raw);
      return status !== 4; // 4 = Fixed (resolved)
    })
    .map(i => new Incident({
      id:        String(i.id),
      name:      i.attributes?.name ?? 'Incident',
      shortlink: `${service.pageUrl}/incidents/${i.id}`,
      impact:    null,
    }));

  const components = componentsData.data
    .filter(c => c.attributes?.enabled !== false)
    .map(c => new Component({
      id:     String(c.id),
      name:   c.attributes?.name ?? 'Component',
      status: parseComponentStatus(c.attributes?.status),
    }));

  const withIncidents = _distributeIncidents(components, incidents);

  const RANK = ['operational', 'under_maintenance', 'degraded_performance', 'partial_outage', 'major_outage'];
  const worst = withIncidents.reduce(
    (acc, c) => RANK.indexOf(c.status) > RANK.indexOf(acc) ? c.status : acc,
    'operational',
  );

  const description = worst === 'operational'
    ? 'All Systems Operational'
    : `${incidents.length || 'Active'} incident(s)`;

  return new Service({
    id:             service.id,
    name:           service.name,
    description,
    pageUrl:        service.pageUrl,
    relatedDomains: service.relatedDomains ?? [],
    searchAliases:  service.searchAliases  ?? [],
    fetchedAt:      new Date().toISOString(),
    components:     withIncidents,
  });
}

module.exports = { fetchCachetStatus };
