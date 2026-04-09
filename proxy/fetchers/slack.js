'use strict';

const { ComponentStatus } = require('../../common/value-objects/component-status.js');
const { ServiceStatus }   = require('../../common/value-objects/service-status.js');
const { _indicatorToStatus } = require('./_helpers.js');

// Slack status values: "ok" | "active" | "broken"
// https://slack-status.com/api/v1.0.0/current
const SLACK_STATUS_MAP = {
  ok:     { indicator: 'none',     description: 'All Systems Operational' },
  active: { indicator: 'minor',    description: 'Active Incident' },
  broken: { indicator: 'critical', description: 'Service Disruption' },
};

async function fetchSlackStatus(service) {
  const res = await fetch(`${service.statusPageUrl}/api/v1.0.0/current`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();

  const mapped = SLACK_STATUS_MAP[data.status]
    ?? { indicator: 'minor', description: `Status: ${data.status}` };

  const components = [new ComponentStatus({
    id:     'service',
    name:   service.name ?? 'Slack',
    status: _indicatorToStatus(mapped.indicator),
  })];

  return new ServiceStatus({
    id:             service.id,
    name:           service.name,
    description:    mapped.description ?? '',
    statusPageUrl:   service.statusPageUrl,
    relatedDomains: service.relatedDomains ?? [],
    searchAliases:  service.searchAliases  ?? [],
    fetchedAt:      new Date().toISOString(),
    components,
  });
}

module.exports = { fetchSlackStatus };
