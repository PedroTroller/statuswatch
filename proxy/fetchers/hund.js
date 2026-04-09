'use strict';

const { Incident }  = require('../../common/value-objects/incident.js');
const { ComponentStatus } = require('../../common/value-objects/component-status.js');
const { ServiceStatus }   = require('../../common/value-objects/service-status.js');
const { _distributeIncidents } = require('./_helpers.js');

// Hund.io: public SSE endpoint at {apiBase}/live/v2/status_page.
// No authentication required.  The first event (init_event) carries the full
// current state and arrives immediately — we read until we receive it, then
// abort the connection.
//
// Hund state strings:
//   operational → operational
//   degraded    → degraded_performance
//   outage      → major_outage
//   maintenance → under_maintenance

const STATE_MAP = {
  operational: 'operational',
  maintenance: 'under_maintenance',
  degraded:    'degraded_performance',
  outage:      'major_outage',
};

async function fetchHundStatus(service) {
  const controller = new AbortController();

  const res = await fetch(`${service.statusPageUrl}/live/v2/status_page`, {
    signal:  controller.signal,
    headers: { Accept: 'text/event-stream' },
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  // Read SSE stream until init_event data line is found, then abort.
  const reader  = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer    = '';
  let initData  = null;

  try {
    outer: while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop(); // retain incomplete trailing line

      let currentEvent = null;
      for (const line of lines) {
        if (line.startsWith('event: ')) {
          currentEvent = line.slice(7).trim();
        } else if (line === '') {
          currentEvent = null;
        } else if (line.startsWith('data: ') && currentEvent === 'init_event') {
          initData = line.slice(6);
          break outer;
        }
      }
    }
  } finally {
    controller.abort();
  }

  if (!initData) throw new Error('No init_event received from Hund SSE stream');

  let parsed;
  try { parsed = JSON.parse(initData); }
  catch { throw new Error('Invalid JSON in Hund init_event'); }

  const incidents = (parsed.issues ?? []).map(i => new Incident({
    id:        String(i.id ?? 'unknown'),
    name:      i.title ?? 'Incident',
    url: i.url ?? `${service.statusPageUrl}/issues/${i.id ?? ''}`,
    impact:    null,
  }));

  const rawComponents = (parsed.groups ?? []).flatMap(group =>
    (group.components ?? []).map(c => new ComponentStatus({
      id:     String(c.id),
      name:   c.name,
      status: STATE_MAP[c.state] ?? 'degraded_performance',
    }))
  );

  const components = _distributeIncidents(rawComponents, incidents);

  const overallStatus = STATE_MAP[parsed.state] ?? 'degraded_performance';
  const description   = overallStatus === 'operational'
    ? 'All Systems Operational'
    : `${incidents.length || 'Active'} incident(s)`;

  return new ServiceStatus({
    id:             service.id,
    name:           service.name,
    description,
    statusPageUrl:   service.statusPageUrl,
    relatedDomains: service.relatedDomains ?? [],
    searchAliases:  service.searchAliases  ?? [],
    fetchedAt:      new Date().toISOString(),
    components,
  });
}

module.exports = { fetchHundStatus };
