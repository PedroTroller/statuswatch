'use strict';

const { Component } = require('../../common/value-objects/component.js');
const { Service }   = require('../../common/value-objects/service.js');
const { _indicatorToStatus } = require('./_helpers.js');

// Slack status values: "ok" | "active" | "broken"
// https://slack-status.com/api/v1.0.0/current
const SLACK_STATUS_MAP = {
  ok:     { indicator: 'none',     description: 'All Systems Operational' },
  active: { indicator: 'minor',    description: 'Active Incident' },
  broken: { indicator: 'critical', description: 'Service Disruption' },
};

async function fetchSlackStatus(service) {
  const res = await fetch(`${service.apiBase}/current`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();

  const mapped = SLACK_STATUS_MAP[data.status]
    ?? { indicator: 'minor', description: `Status: ${data.status}` };

  const components = [new Component({
    id:     'service',
    name:   service.name ?? 'Slack',
    status: _indicatorToStatus(mapped.indicator),
  })];

  return new Service({
    id:             service.id,
    name:           service.name,
    description:    mapped.description ?? '',
    pageUrl:        service.pageUrl,
    relatedDomains: service.relatedDomains ?? [],
    searchAliases:  service.searchAliases  ?? [],
    fetchedAt:      new Date().toISOString(),
    components,
  });
}

module.exports = { fetchSlackStatus };
