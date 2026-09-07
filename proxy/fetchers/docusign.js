'use strict';

const { Incident }        = require('../../common/value-objects/incident.js');
const { ComponentStatus } = require('../../common/value-objects/component-status.js');
const { ServiceStatus }   = require('../../common/value-objects/service-status.js');
const { safeJson, _distributeIncidents } = require('./_helpers.js');

// DocuSign retired its Statuspage instance for a status centre of its own, and
// status.docusign.com now redirects to health.docusign.com/status. That page has
// no /api/v2 surface; it loads two JSON documents from the path its own bundle
// calls CDN_HOST:
//   {origin}/production/1ds/ssg/apps/health/dynamic/components.json
//   {origin}/production/1ds/ssg/apps/health/dynamic/incidents.json
// The bundle also ships demo, integration and stage variants of that prefix;
// only the production one is served by the public page.
const API_PATH = '/production/1ds/ssg/apps/health/dynamic';

// The platform has exactly three severities, taken from the severity table in
// its own bundle: { available, performance_degradation, service_disruption }.
// `service_disruption` is the top of their scale, so it maps to the top of ours:
// with nothing above it, a disruption must not be reported as anything milder.
const DOCUSIGN_STATUS_MAP = {
  available:               'operational',
  performance_degradation: 'degraded_performance',
  service_disruption:      'major_outage',
};

const RANK = ['operational', 'under_maintenance', 'degraded_performance', 'partial_outage', 'major_outage'];

function toStatus(raw) {
  return DOCUSIGN_STATUS_MAP[raw] ?? 'degraded_performance';
}

function worse(a, b) {
  return RANK.indexOf(b) > RANK.indexOf(a) ? b : a;
}

// Components form a three-level tree: a `group` holds `product`s, and every
// product holds one `site` per region or environment. Products are the only
// level with names worth showing: the 68 sites repeat "DEMO", "EU" and "US"
// across products, so they would be indistinguishable in a component list.
//
// A product's status is the worst of its own and of every site beneath it,
// which holds whether or not the platform rolls child status up into parents.
function productComponents(components) {
  const childrenOf = new Map();
  for (const c of components) {
    if (!c.parentId) continue;
    if (!childrenOf.has(c.parentId)) childrenOf.set(c.parentId, []);
    childrenOf.get(c.parentId).push(c);
  }

  const worstBelow = (component) => {
    let status = toStatus(component.status);
    for (const child of childrenOf.get(component.id) ?? []) {
      status = worse(status, worstBelow(child));
    }
    return status;
  };

  return components
    .filter(c => c.type === 'product')
    .map(c => new ComponentStatus({ id: c.id, name: c.name, status: worstBelow(c) }));
}

async function fetchDocusignStatus(service) {
  const base          = `${new URL(service.statusPageUrl).origin}${API_PATH}`;
  const componentsUrl = `${base}/components.json`;

  const [componentsRes, incidentsRes] = await Promise.all([
    fetch(componentsUrl),
    fetch(`${base}/incidents.json`).catch(() => null),
  ]);

  if (!componentsRes.ok) {
    throw new Error(`Components API returned ${componentsRes.status} for ${componentsUrl}`);
  }

  const componentsData = await safeJson(componentsRes);
  if (!Array.isArray(componentsData?.components)) {
    throw new Error(`Invalid DocuSign components response from ${componentsUrl}`);
  }

  const components = productComponents(componentsData.components);
  if (components.length === 0) {
    throw new Error(`No product components in ${componentsUrl}`);
  }

  const incidentsData = incidentsRes?.ok ? await safeJson(incidentsRes) : null;

  const incidents = (incidentsData?.incidents ?? [])
    .filter(i => i.status !== 'resolved')
    .map(i => new Incident({
      id:     i.incidentId,
      name:   i.title,
      url:    `${service.statusPageUrl}/incidents?id=${i.incidentId}`,
      impact: i.impact ?? null,
    }));

  const worst = components.reduce((acc, c) => worse(acc, c.status), 'operational');

  return new ServiceStatus({
    id:             service.id,
    name:           service.name,
    description:    worst === 'operational' ? 'All Systems Operational' : 'Service disruption',
    statusPageUrl:  service.statusPageUrl,
    relatedDomains: service.relatedDomains ?? [],
    searchAliases:  service.searchAliases  ?? [],
    fetchedAt:      new Date().toISOString(),
    components:     _distributeIncidents(components, incidents, worst),
  });
}

module.exports = { fetchDocusignStatus };
