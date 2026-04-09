'use strict';

const { Incident }  = require('../../common/value-objects/incident.js');
const { ComponentStatus } = require('../../common/value-objects/component-status.js');
const { ServiceStatus }   = require('../../common/value-objects/service-status.js');
const { safeJson, _distributeIncidents } = require('./_helpers.js');

// Heroku: custom Rails API at status.heroku.com/api/v4/current-status.
// System status: "green" | "yellow" | "red". Worst system wins for indicator.
const HEROKU_STATUS_MAP = {
  green:  { comp: 'operational',          ind: 'none'     },
  yellow: { comp: 'degraded_performance', ind: 'minor'    },
  red:    { comp: 'major_outage',         ind: 'critical' },
};

async function fetchHerokuStatus(service) {
  const res = await fetch(`${service.statusPageUrl}/api/v4/current-status`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await safeJson(res);
  if (!Array.isArray(data?.status)) throw new Error('Invalid Heroku response');

  const rawComponents = data.status.map(s => {
    const mapped = HEROKU_STATUS_MAP[s.status] ?? { comp: 'degraded_performance', ind: 'minor' };
    return new ComponentStatus({ id: s.system.toLowerCase(), name: s.system, status: mapped.comp });
  });

  const incidents = (data.incidents ?? []).map(i => new Incident({
    id:        String(i.id),
    name:      i.title ?? String(i.id),
    url: `${service.statusPageUrl}/incidents/${i.id}`,
    impact:    null,
  }));

  const components = _distributeIncidents(rawComponents, incidents);
  const hasIssue   = rawComponents.some(c => c.status !== 'operational');
  const description = hasIssue ? 'Active issue' : 'All Systems Operational';

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

module.exports = { fetchHerokuStatus };
