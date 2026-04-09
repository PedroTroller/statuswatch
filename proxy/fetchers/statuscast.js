'use strict';

const { Incident }  = require('../../common/value-objects/incident.js');
const { ComponentStatus } = require('../../common/value-objects/component-status.js');
const { ServiceStatus }   = require('../../common/value-objects/service-status.js');
const { safeJson, _distributeIncidents } = require('./_helpers.js');

// StatusCast: platform used by e.g. Fastly. Three JSON endpoints at the page root:
//   /status.json      — overall status: { Status, StatusText, … }
//   /components.json  — array of components with CurrentStatus
//   /incidents.json   — all incidents; active ones have Status "InProgress"
// StatusCast blocks non-browser UAs; the UA header is a no-op in Chrome (forbidden
// header, ignored silently) but makes Node.js tests pass.
const STATUSCAST_BROWSER_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const STATUSCAST_STATUS_MAP = {
  Available:     { comp: 'operational',          ind: 'none'     },
  Monitoring:    { comp: 'degraded_performance', ind: 'minor'    },
  Degraded:      { comp: 'degraded_performance', ind: 'minor'    },
  PartialOutage: { comp: 'partial_outage',       ind: 'major'    },
  Unavailable:   { comp: 'major_outage',         ind: 'critical' },
  Maintenance:   { comp: 'under_maintenance',    ind: 'maintenance' },
};

async function fetchStatuscastStatus(service) {
  const headers = { 'User-Agent': STATUSCAST_BROWSER_UA };
  const [statusRes, componentsRes, incidentsRes] = await Promise.all([
    fetch(`${service.statusPageUrl}/status.json`,     { headers }),
    fetch(`${service.statusPageUrl}/components.json`, { headers }),
    fetch(`${service.statusPageUrl}/incidents.json`,  { headers }).catch(() => null),
  ]);

  if (!statusRes.ok)     throw new Error(`Status API returned ${statusRes.status}`);
  if (!componentsRes.ok) throw new Error(`Components API returned ${componentsRes.status}`);

  const statusData     = await safeJson(statusRes);
  const componentsData = await safeJson(componentsRes);
  const incidentsData  = incidentsRes?.ok ? await safeJson(incidentsRes) : [];

  if (!statusData?.Status) throw new Error('Invalid StatusCast response');

  const mapped = STATUSCAST_STATUS_MAP[statusData.Status] ?? { comp: 'degraded_performance', ind: 'minor' };

  const incidents = (Array.isArray(incidentsData) ? incidentsData : [])
    .filter(i => i.Status === 'InProgress')
    .map(i => new Incident({
      id:        String(i.Id),
      name:      i.Title,
      url: i.ShortUrl ?? `${service.statusPageUrl}`,
      impact:    i.IncidentType ?? null,
    }));

  const rawComponents = (Array.isArray(componentsData) ? componentsData : [])
    .filter(c => c.Level === 1)
    .map(c => {
      const m = STATUSCAST_STATUS_MAP[c.CurrentStatus] ?? { comp: 'degraded_performance' };
      return new ComponentStatus({ id: String(c.id), name: c.text, status: m.comp });
    });

  const components = _distributeIncidents(rawComponents, incidents, mapped.comp);
  const description = statusData.StatusText ?? (mapped.ind === 'none' ? 'All Systems Operational' : '');
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

module.exports = { fetchStatuscastStatus };
