'use strict';

const { ComponentStatus } = require('../../common/value-objects/component-status.js');
const { ServiceStatus }   = require('../../common/value-objects/service-status.js');
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
  const res = await fetch(`${service.statusPageUrl}/current/full`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await safeJson(res);
  if (!data?.UptimeStatus) throw new Error('Invalid Stripe response');

  const indicator = STRIPE_UPTIME_MAP[data.UptimeStatus] ?? 'major';
  const description = data.message ?? '';

  let components = (data.uptimeData ?? []).map(u => new ComponentStatus({
    id:     u.key,
    name:   u.title,
    status: u.warning == null ? 'operational' : 'degraded_performance',
  }));

  // If no uptimeData but the API reports a non-operational state,
  // create a synthetic component so Service.status reflects reality.
  if (components.length === 0 && indicator !== 'none') {
    components = [new ComponentStatus({
      id:     'service',
      name:   service.name ?? 'Service',
      status: _indicatorToStatus(indicator),
    })];
  }

  return new ServiceStatus({
    id:             service.id,
    name:           service.name,
    description:    description ?? '',
    statusPageUrl:   service.statusPageUrl,
    relatedDomains: service.relatedDomains ?? [],
    searchAliases:  service.searchAliases  ?? [],
    fetchedAt:      new Date().toISOString(),
    components,
  });
}

module.exports = { fetchStripeStatus };
