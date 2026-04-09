'use strict';

const { Incident }  = require('../../common/value-objects/incident.js');
const { Component } = require('../../common/value-objects/component.js');
const { Service }   = require('../../common/value-objects/service.js');
const { safeJson, _distributeIncidents } = require('./_helpers.js');

// Algolia: custom React app. Status API at status.algolia.com/3/public/availability.
// Components are services; current status is the last entry in uptime_days.
// Status values use hyphens: "operational" | "degraded-performance" | "major-outage".
const ALGOLIA_STATUS_MAP = {
  'operational':         'operational',
  'degraded-performance':'degraded_performance',
  'major-outage':        'major_outage',
};

async function fetchAlgoliaStatus(service) {
  const [availRes, incidentsRes] = await Promise.all([
    fetch(`${service.apiBase}/3/public/availability`),
    fetch(`${service.apiBase}/3/public/incidents`).catch(() => null),
  ]);
  if (!availRes.ok) throw new Error(`HTTP ${availRes.status}`);
  const availData    = await safeJson(availRes);
  const incidentsData = incidentsRes?.ok ? await safeJson(incidentsRes) : [];
  if (!availData || typeof availData !== 'object') throw new Error('Invalid Algolia response');

  const services = Object.values(availData);
  const rawComponents = services.map(s => {
    const last   = s.uptime_days?.[s.uptime_days.length - 1];
    const status = ALGOLIA_STATUS_MAP[last?.status] ?? 'operational';
    return new Component({ id: s.type, name: s.name, status });
  });

  const incidents = (Array.isArray(incidentsData) ? incidentsData : [])
    .filter(i => !i.resolved_at)
    .map(i => new Incident({
      id:        String(i.id),
      name:      i.name ?? i.title ?? 'Incident',
      shortlink: `${service.pageUrl}/incidents/${i.id}`,
      impact:    i.current_severity ?? null,
    }));

  const components = _distributeIncidents(rawComponents, incidents);
  const hasIssue   = rawComponents.some(c => c.status !== 'operational');
  const description = hasIssue
    ? `${incidents.length || 'Active'} incident(s)`
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

module.exports = { fetchAlgoliaStatus };
