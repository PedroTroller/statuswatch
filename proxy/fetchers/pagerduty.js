'use strict';

const { Incident }  = require('../../common/value-objects/incident.js');
const { Component } = require('../../common/value-objects/component.js');
const { Service }   = require('../../common/value-objects/service.js');
const { safeJson } = require('./_helpers.js');

// PagerDuty: their own status-page product. Two endpoints:
//   /api/services              — full service list (components); no current status field.
//   /api/posts?statuses[]=...  — active posts (investigating | detected).
// Component status is inferred: affected by an active post → degraded, else operational.
// Severity: "minor" → minor, "major" → critical.

async function fetchPagerdutySatus(service) {
  const activeStatuses = 'statuses%5B%5D=investigating&statuses%5B%5D=detected';
  const [servicesRes, postsRes] = await Promise.all([
    fetch(`${service.apiBase}/api/services`),
    fetch(`${service.apiBase}/api/posts?${activeStatuses}&limit=500`),
  ]);
  if (!servicesRes.ok) throw new Error(`HTTP ${servicesRes.status}`);
  const servicesData = await safeJson(servicesRes);
  if (!Array.isArray(servicesData?.services)) throw new Error('Invalid PagerDuty response');

  const activePosts = postsRes.ok ? ((await safeJson(postsRes))?.posts ?? []) : [];

  const affectedIds = new Set(
    activePosts.flatMap(p => (p.incident_services ?? []).map(s => s.id))
  );

  // Build per-service incident map (incidents attach to their affected services)
  const incidentsByService = {};
  for (const p of activePosts) {
    const inc = new Incident({
      id:        p.id,
      name:      p.title ?? p.id,
      shortlink: `${service.pageUrl}/posts/${p.id}`,
      impact:    p.current_post_severity_enum?.name ?? null,
    });
    for (const s of p.incident_services ?? []) {
      if (!incidentsByService[s.id]) incidentsByService[s.id] = [];
      incidentsByService[s.id].push(inc);
    }
  }

  const components = servicesData.services
    .filter(s => s.is_active)
    .map(s => new Component({
      id:              s.id,
      name:            s.display_name ?? s.name,
      status:          affectedIds.has(s.id) ? 'degraded_performance' : 'operational',
      activeIncidents: incidentsByService[s.id] ?? [],
    }));

  const hasIssue = activePosts.length > 0;
  const description = hasIssue
    ? `${activePosts.length} active incident(s)`
    : 'All Systems Operational';

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

module.exports = { fetchPagerdutySatus };
