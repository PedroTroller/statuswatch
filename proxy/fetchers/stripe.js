'use strict';

const { Component } = require('../../common/value-objects/component.js');
const { Service }   = require('../../common/value-objects/service.js');
const { safeJson, _indicatorToStatus } = require('./_helpers.js');

// Stripe: custom status page at status.stripe.com/current/full.
// UptimeStatus: "up" | "degraded" | "down". Components from uptimeData[].
// warning===null means operational; any non-null warning means degraded.
const STRIPE_UPTIME_MAP = {
  up:       'none',
  degraded: 'minor',
  down:     'critical',
};

async function fetchStripeStatus(service) {
  const res = await fetch(`${service.apiBase}/current/full`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await safeJson(res);
  if (!data?.UptimeStatus) throw new Error('Invalid Stripe response');

  const indicator = STRIPE_UPTIME_MAP[data.UptimeStatus] ?? 'major';
  const description = data.message ?? '';

  let components = (data.uptimeData ?? []).map(u => new Component({
    id:     u.key,
    name:   u.title,
    status: u.warning == null ? 'operational' : 'degraded_performance',
  }));

  // If no uptimeData but the API reports a non-operational state,
  // create a synthetic component so Service.status reflects reality.
  if (components.length === 0 && indicator !== 'none') {
    components = [new Component({
      id:     'service',
      name:   service.name ?? 'Service',
      status: _indicatorToStatus(indicator),
    })];
  }

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

module.exports = { fetchStripeStatus };
