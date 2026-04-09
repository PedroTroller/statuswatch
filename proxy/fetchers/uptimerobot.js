'use strict';

const { ComponentStatus } = require('../../common/value-objects/component-status.js');
const { ServiceStatus }   = require('../../common/value-objects/service-status.js');
const { safeJson } = require('./_helpers.js');

// UptimeRobot status pages: /api/getMonitorList/{key} — the key segment is not
// validated server-side; any non-empty string works. Binary up/down model:
//   statusClass "success" → up, "danger" → down, "black" → paused.
// Aggregate indicator: none (all up) / major (some down) / critical (all down).
async function fetchUptimeRobotStatus(service) {
  const res = await fetch(`${service.statusPageUrl}/api/getMonitorList/x`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await safeJson(res);
  if (!data?.statistics?.counts) throw new Error('Invalid UptimeRobot response');

  const { up: _up, down, total } = data.statistics.counts;

  const description = data.statistics.count_result
    ?? (down === 0 ? 'All Systems Operational' : `${down} of ${total} monitors down`);

  const monitors = data.psp?.monitors ?? data.data ?? [];
  let components = monitors.map(m => new ComponentStatus({
    id:     String(m.monitorId),
    name:   m.name,
    status: m.statusClass === 'success' ? 'operational'
          : m.statusClass === 'danger'  ? 'major_outage'
          :                               'under_maintenance',
  }));

  // If no monitor data but statistics show monitors are down,
  // create a synthetic component so Service.status reflects reality.
  if (components.length === 0 && down > 0) {
    components = [new ComponentStatus({
      id:     'service',
      name:   service.name ?? 'Service',
      status: down === total ? 'major_outage' : 'partial_outage',
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

module.exports = { fetchUptimeRobotStatus };
