'use strict';

const { Incident }  = require('../../common/value-objects/incident.js');
const { Component } = require('../../common/value-objects/component.js');
const { Service }   = require('../../common/value-objects/service.js');

// ── AWS Health ────────────────────────────────────────────────────────────────
// Polls /public/currentevents — returns all active AWS service events worldwide.
// The response is UTF-16 encoded (with BOM); decoded via TextDecoder('utf-16').
//
// Event status codes: "1" = Investigating, "2" = Identified, "3" = Monitoring.
// All events in currentevents are active; status "3" (monitoring) is resolving.

async function fetchAwsHealthStatus(service) {
  const res = await fetch(`${service.apiBase}/public/currentevents`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  // Response is UTF-16 BE (BOM feff); use 'utf-16be' explicitly since
  // 'utf-16' defaults to LE in the WHATWG spec.
  const buf  = await res.arrayBuffer();
  const text = new TextDecoder('utf-16be').decode(buf);
  const data = JSON.parse(text);
  if (!Array.isArray(data)) throw new Error('Invalid AWS Health response');

  if (data.length === 0) {
    return new Service({
      id:             service.id,
      name:           service.name,
      description:    'All Services Operational',
      pageUrl:        service.pageUrl,
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
      shortlink: service.pageUrl,
    }));
  }

  const components = Object.values(byKey).map(c => new Component({
    id:              c.id,
    name:            c.name,
    status:          'partial_outage',
    activeIncidents: c.incidents,
  }));

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

module.exports = { fetchAwsHealthStatus };
