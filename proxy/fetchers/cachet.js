'use strict';

const { Incident }  = require('../../common/value-objects/incident.js');
const { ComponentStatus } = require('../../common/value-objects/component-status.js');
const { ServiceStatus }   = require('../../common/value-objects/service-status.js');
const { safeJson, _distributeIncidents } = require('./_helpers.js');

// Cachet component status integers:
//   1 → operational, 2 → degraded_performance, 3 → partial_outage,
//   4 → major_outage, 5 → under_maintenance
const COMPONENT_STATUS_MAP = {
  1: 'operational',
  2: 'degraded_performance',
  3: 'partial_outage',
  4: 'major_outage',
  5: 'under_maintenance',
};

// Cachet v3 (JSON:API) nests fields under `attributes`; v1/v2 puts them directly on the object.
const attrs = obj => obj.attributes ?? obj;

// Cachet v3 returns status as { value: "1" }; v1/v2 returns a plain integer.
function parseComponentStatus(raw) {
  const n = typeof raw === 'object' ? parseInt(raw?.value, 10) : Number(raw);
  return COMPONENT_STATUS_MAP[n] ?? 'degraded_performance';
}

const HEADERS = { 'User-Agent': 'Mozilla/5.0 (compatible; statuswatch/1.0)' };

async function fetchCachetStatus(service) {
  const [componentsRes, incidentsRes] = await Promise.all([
    fetch(`${service.statusPageUrl}/api/v1/components?per_page=100`, { headers: HEADERS }),
    fetch(`${service.statusPageUrl}/api/v1/incidents?per_page=20&sort=-id`, { headers: HEADERS }),
  ]);

  if (!componentsRes.ok) throw new Error(`Components API returned ${componentsRes.status}`);

  const componentsData = await safeJson(componentsRes);
  const incidentsData  = incidentsRes.ok ? await safeJson(incidentsRes) : null;

  if (!Array.isArray(componentsData?.data)) throw new Error('Invalid Cachet components response');

  const incidents = (incidentsData?.data ?? [])
    .filter(i => {
      const raw    = attrs(i).status;
      const status = typeof raw === 'object' ? parseInt(raw?.value, 10) : Number(raw);
      return status !== 4; // 4 = Fixed (resolved)
    })
    .map(i => new Incident({
      id:        String(i.id),
      name:      attrs(i).name ?? 'Incident',
      url: `${service.statusPageUrl}/incidents/${i.id}`,
      impact:    null,
    }));

  const components = componentsData.data
    .filter(c => attrs(c).enabled !== false)
    .map(c => new ComponentStatus({
      id:     String(c.id),
      name:   attrs(c).name ?? 'Component',
      status: parseComponentStatus(attrs(c).status),
    }));

  const withIncidents = _distributeIncidents(components, incidents);

  const RANK = ['operational', 'under_maintenance', 'degraded_performance', 'partial_outage', 'major_outage'];
  const worst = withIncidents.reduce(
    (acc, c) => RANK.indexOf(c.status) > RANK.indexOf(acc) ? c.status : acc,
    'operational',
  );

  const description = worst === 'operational'
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
    components:     withIncidents,
  });
}

module.exports = { fetchCachetStatus };
