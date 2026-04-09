'use strict';

const { ComponentStatus } = require('../../common/value-objects/component-status.js');
const { ServiceStatus }   = require('../../common/value-objects/service-status.js');
const { safeJson }  = require('./_helpers.js');

// Instatus component status strings → our enum.
// No incidents endpoint is publicly available; status is derived from components only.
const STATUS_MAP = {
  OPERATIONAL:        'operational',
  UNDERMAINTENANCE:   'under_maintenance',
  DEGRADEDPERFORMANCE:'degraded_performance',
  PARTIALOUTAGE:      'partial_outage',
  MAJOROUTAGE:        'major_outage',
};

async function fetchInstatusStatus(service) {
  const [summaryRes, componentsRes] = await Promise.all([
    fetch(`${service.statusPageUrl}/api/v2/summary.json`),
    fetch(`${service.statusPageUrl}/api/v2/components.json`),
  ]);

  if (!componentsRes.ok) throw new Error(`Components API returned ${componentsRes.status}`);

  const componentsData = await safeJson(componentsRes);
  if (!Array.isArray(componentsData?.components)) throw new Error('Invalid Instatus components response');

  const components = componentsData.components
    .filter(c => !c.isParent)
    .map(c => new ComponentStatus({
      id:     c.id,
      name:   c.name,
      status: STATUS_MAP[c.status] ?? 'degraded_performance',
    }));

  const RANK = ['operational', 'under_maintenance', 'degraded_performance', 'partial_outage', 'major_outage'];
  const worst = components.reduce(
    (acc, c) => RANK.indexOf(c.status) > RANK.indexOf(acc) ? c.status : acc,
    'operational',
  );

  const description = worst === 'operational' ? 'All Systems Operational' : 'Service disruption';

  return new ServiceStatus({
    id:             service.id,
    name:           service.name,
    description,
    statusPageUrl:   service.statusPageUrl,
    relatedDomains: service.relatedDomains ?? [],
    searchAliases:  service.searchAliases  ?? [],
    fetchedAt:      new Date().toISOString(),
    components,
  });
}

module.exports = { fetchInstatusStatus };
