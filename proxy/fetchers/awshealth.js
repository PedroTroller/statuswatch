'use strict';

const { Incident }  = require('../../common/value-objects/incident.js');
const { ComponentStatus } = require('../../common/value-objects/component-status.js');
const { ServiceStatus }   = require('../../common/value-objects/service-status.js');

// ── AWS Health ────────────────────────────────────────────────────────────────
// Polls /public/currentevents — returns all active AWS service events worldwide.
// The response is UTF-16 encoded (with BOM); decoded via TextDecoder('utf-16').
//
// Event status codes: "1" = Investigating, "2" = Identified, "3" = Monitoring.
// All events in currentevents are active; status "3" (monitoring) is resolving.

async function fetchAwsHealthStatus(service) {
  const res = await fetch('https://health.aws.amazon.com/public/currentevents');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  // Response is UTF-16 BE (BOM feff); use 'utf-16be' explicitly since
  // 'utf-16' defaults to LE in the WHATWG spec.
  const buf  = await res.arrayBuffer();
  const text = new TextDecoder('utf-16be').decode(buf);
  const data = JSON.parse(text);
  if (!Array.isArray(data)) throw new Error('Invalid AWS Health response');

  if (data.length === 0) {
    return new ServiceStatus({
      id:             service.id,
      name:           service.name,
      description:    'All Services Operational',
      statusPageUrl:   service.statusPageUrl,
      relatedDomains: service.relatedDomains ?? [],
      searchAliases:  service.searchAliases  ?? [],
      fetchedAt:      new Date().toISOString(),
      components:     [],
    });
  }

  const description = data.length === 1
    ? `${data[0].service_name} — ${data[0].region_name}`
    : `${data.length} active events`;

  // Deduplicate by service-region for component list; gather per-component incidents.
  const byKey = {};
  for (const ev of data) {
    const key = `${ev.service}-${ev.region_name}`;
    if (!byKey[key]) {
      byKey[key] = {
        id:        key,
        name:      `${ev.service_name} — ${ev.region_name}`,
        incidents: [],
      };
    }
    byKey[key].incidents.push(new Incident({
      name:      ev.summary,
      url: service.statusPageUrl,
    }));
  }

  const components = Object.values(byKey).map(c => new ComponentStatus({
    id:              c.id,
    name:            c.name,
    status:          'partial_outage',
    activeIncidents: c.incidents,
  }));

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

module.exports = { fetchAwsHealthStatus };
