'use strict';

const { Incident }  = require('../../common/value-objects/incident.js');
const { Component } = require('../../common/value-objects/component.js');
const { Service }   = require('../../common/value-objects/service.js');
const { safeJson } = require('./_helpers.js');

// Google Workspace status dashboard: polls /incidents.json (CORS-open, no auth).
// Active incidents have no `end` field. Indicator and components are derived
// from the worst status_impact across all active incidents.
const _GW_IMPACT_TO_INDICATOR = {
  SERVICE_OUTAGE:      'critical',
  SERVICE_DISRUPTION:  'major',
  SERVICE_INFORMATION: 'minor',
};
const _GW_IMPACT_TO_COMP_STATUS = {
  SERVICE_OUTAGE:      'major_outage',
  SERVICE_DISRUPTION:  'partial_outage',
  SERVICE_INFORMATION: 'degraded_performance',
};
const _GW_SEVERITY_RANK = { critical: 3, major: 2, minor: 1, none: 0 };

async function fetchGoogleIncidentDashboard(service) {
  const [incidentsRes, productsRes] = await Promise.all([
    fetch(`${service.apiBase}/incidents.json`),
    fetch(`${service.apiBase}/products.json`),
  ]);

  if (!incidentsRes.ok) throw new Error(`HTTP ${incidentsRes.status}`);
  const incidents = await safeJson(incidentsRes);
  if (!Array.isArray(incidents)) throw new Error('Invalid Google Workspace response');

  const productsData = productsRes.ok ? await safeJson(productsRes) : null;
  const allProducts  = productsData?.products ?? [];

  const active = incidents.filter(i => !i.end);

  // Per-product status from active incidents (worst impact wins per product)
  const byProduct = {};
  for (const i of active) {
    const compStatus = _GW_IMPACT_TO_COMP_STATUS[i.status_impact] ?? 'degraded_performance';
    for (const p of i.affected_products ?? []) {
      const cur = byProduct[p.id];
      if (!cur || _GW_SEVERITY_RANK[_GW_IMPACT_TO_INDICATOR[i.status_impact]] >
                  _GW_SEVERITY_RANK[_GW_IMPACT_TO_INDICATOR[cur._impact]]) {
        byProduct[p.id] = { id: p.id, name: p.title, status: compStatus, _impact: i.status_impact };
      }
    }
  }

  // Build per-product incident lists (each incident attaches to its affected products)
  const incidentsByProduct = {};
  for (const i of active) {
    const inc = new Incident({
      id:        i.id,
      name:      i.affected_products?.length
                   ? i.affected_products.map(p => p.title).join(', ')
                   : (i.service_name ?? 'Incident'),
      shortlink: `${service.pageUrl}/${i.uri}`,
      impact:    i.status_impact,
    });
    for (const p of i.affected_products ?? []) {
      if (!incidentsByProduct[p.id]) incidentsByProduct[p.id] = [];
      incidentsByProduct[p.id].push(inc);
    }
  }

  // All products as components, defaulting to operational
  const components = allProducts.map(p => new Component({
    id:              p.id,
    name:            p.title,
    status:          byProduct[p.id]?.status ?? 'operational',
    activeIncidents: incidentsByProduct[p.id] ?? [],
  }));

  const description = active.length === 0
    ? 'All Systems Operational'
    : `${active.length} active incident${active.length > 1 ? 's' : ''}`;

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

module.exports = { fetchGoogleIncidentDashboard };
