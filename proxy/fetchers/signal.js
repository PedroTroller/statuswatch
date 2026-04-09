'use strict';

const { ComponentStatus } = require('../../common/value-objects/component-status.js');
const { ServiceStatus }   = require('../../common/value-objects/service-status.js');

// Signal's status page (https://status.signal.org) has no machine-readable API.
// It's a hand-rolled HTML page whose only content is either:
//   "Signal is up and running."   → operational
//   anything else                 → major_outage
// Marked beta in the catalog because any wording change would silently break this.

async function fetchSignalStatus(service) {
  const res = await fetch(service.statusPageUrl);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const html   = await res.text();
  const isUp   = html.includes('up and running');
  const status = isUp ? 'operational' : 'major_outage';

  return new ServiceStatus({
    id:             service.id,
    name:           service.name,
    description:    isUp ? 'All Systems Operational' : 'Service disruption',
    statusPageUrl:   service.statusPageUrl,
    relatedDomains: service.relatedDomains ?? [],
    searchAliases:  service.searchAliases  ?? [],
    fetchedAt:      new Date().toISOString(),
    components:     [new ComponentStatus({ id: 'signal', name: 'Signal', status })],
  });
}

module.exports = { fetchSignalStatus };
