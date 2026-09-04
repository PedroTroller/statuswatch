'use strict';

const { ComponentStatus } = require('../../common/value-objects/component-status.js');
const { ServiceStatus }   = require('../../common/value-objects/service-status.js');
const { safeJson }  = require('./_helpers.js');

// Instatus page-level status strings → our enum. Used only when the page
// exposes no leaf component at all.
const PAGE_STATUS_MAP = {
  UP:               'operational',
  HASISSUES:        'degraded_performance',
  UNDERMAINTENANCE: 'under_maintenance',
};

// Instatus component status strings → our enum.
// No incidents endpoint is publicly available; status is derived from components only.
const STATUS_MAP = {
  OPERATIONAL:        'operational',
  UNDERMAINTENANCE:   'under_maintenance',
  DEGRADEDPERFORMANCE:'degraded_performance',
  PARTIALOUTAGE:      'partial_outage',
  MAJOROUTAGE:        'major_outage',
};

// Instatus nests components under groups. Only leaves carry a meaningful
// status, and walking the top level alone silently drops every nested child:
// Airbyte exposes 85 leaves under 12 top-level entries, of which the flat read
// saw 9, and Deno and Mollie expose nothing but groups at the top level, so the
// flat read saw none at all and the service always looked operational.
function leafComponents(components) {
  const leaves = [];
  const walk = (list) => {
    for (const c of list ?? []) {
      const children = c.children ?? [];
      if (children.length > 0) walk(children);
      else leaves.push(c);
    }
  };
  walk(components);
  return leaves;
}

async function fetchInstatusStatus(service) {
  const [summaryRes, componentsRes] = await Promise.all([
    fetch(`${service.statusPageUrl}/api/v2/summary.json`),
    fetch(`${service.statusPageUrl}/api/v2/components.json`),
  ]);

  if (!componentsRes.ok) throw new Error(`Components API returned ${componentsRes.status}`);

  const componentsData = await safeJson(componentsRes);
  if (!Array.isArray(componentsData?.components)) throw new Error('Invalid Instatus components response');

  const summaryData = summaryRes.ok ? await safeJson(summaryRes) : null;

  const components = leafComponents(componentsData.components)
    .map(c => new ComponentStatus({
      id:     c.id,
      name:   c.name,
      status: STATUS_MAP[c.status] ?? 'degraded_performance',
    }));

  // A page with no leaf component would otherwise be reported operational
  // whatever it says, since the status below is the worst of an empty list.
  if (components.length === 0) {
    const pageStatus = summaryData?.page?.status;
    components.push(new ComponentStatus({
      id:     'service',
      name:   'Service',
      status: PAGE_STATUS_MAP[pageStatus] ?? 'degraded_performance',
    }));
  }

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
