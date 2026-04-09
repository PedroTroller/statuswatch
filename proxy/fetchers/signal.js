'use strict';

const { Component } = require('../../common/value-objects/component.js');
const { Service }   = require('../../common/value-objects/service.js');

// Signal's status page (https://status.signal.org) has no machine-readable API.
// It's a hand-rolled HTML page whose only content is either:
//   "Signal is up and running."   → operational
//   anything else                 → major_outage
// Marked beta in the catalog because any wording change would silently break this.

async function fetchSignalStatus(service) {
  const res = await fetch(service.apiBase);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const html   = await res.text();
  const isUp   = html.includes('up and running');
  const status = isUp ? 'operational' : 'major_outage';

  return new Service({
    id:             service.id,
    name:           service.name,
    description:    isUp ? 'All Systems Operational' : 'Service disruption',
    pageUrl:        service.pageUrl,
    relatedDomains: service.relatedDomains ?? [],
    searchAliases:  service.searchAliases  ?? [],
    fetchedAt:      new Date().toISOString(),
    components:     [new Component({ id: 'signal', name: 'Signal', status })],
  });
}

module.exports = { fetchSignalStatus };
