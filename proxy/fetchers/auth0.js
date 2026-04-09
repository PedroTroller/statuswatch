'use strict';

const { Incident }  = require('../../common/value-objects/incident.js');
const { Component } = require('../../common/value-objects/component.js');
const { Service }   = require('../../common/value-objects/service.js');
const { safeJson } = require('./_helpers.js');

// Auth0: custom Next.js status page. Build ID rotates on every deploy, so it must
// be extracted from the HTML page first, then used to fetch /_next/data/{id}/index.json.
// Components = regions (US-1, EU-1, …); incident status and impact map to our scale.
const AUTH0_STATUS_MAP = {
  operational:          { comp: 'operational',          ind: 'none'     },
  degraded_performance: { comp: 'degraded_performance', ind: 'minor'    },
  partial_outage:       { comp: 'partial_outage',       ind: 'major'    },
  major_outage:         { comp: 'major_outage',         ind: 'critical' },
  under_maintenance:    { comp: 'under_maintenance',    ind: 'minor'    },
};
const AUTH0_SEVERITY_RANK = { none: 0, minor: 1, major: 2, critical: 3 };

async function fetchAuth0Status(service) {
  const pageRes = await fetch(service.pageUrl);
  if (!pageRes.ok) throw new Error(`HTTP ${pageRes.status}`);
  const html    = await pageRes.text();
  const buildId = html.match(/"buildId":"([^"]+)"/)?.[1];
  if (!buildId) throw new Error('Auth0: buildId not found in page HTML');

  const dataRes = await fetch(`${service.apiBase}/_next/data/${buildId}/index.json`);
  if (!dataRes.ok) throw new Error(`HTTP ${dataRes.status}`);
  const data = await safeJson(dataRes);
  if (!Array.isArray(data?.pageProps?.activeIncidents)) throw new Error('Invalid Auth0 response');

  const regions = data.pageProps.activeIncidents;

  const components = regions.map(r => {
    let worstInd  = 'none';
    let worstComp = 'operational';
    const incidents = [];
    for (const i of r.response?.incidents ?? []) {
      const m = AUTH0_STATUS_MAP[i.status] ?? { comp: 'degraded_performance', ind: 'minor' };
      if (AUTH0_SEVERITY_RANK[m.ind] > AUTH0_SEVERITY_RANK[worstInd]) {
        worstInd  = m.ind;
        worstComp = m.comp;
      }
      if (i.status !== 'operational' && i.id) {
        incidents.push(new Incident({
          id:        i.id,
          name:      i.name,
          shortlink: `${service.pageUrl}/incidents/${i.id}`,
          impact:    i.impact ?? null,
        }));
      }
    }
    return new Component({
      id:              r.region,
      name:            `${r.region} (${r.environment})`,
      status:          worstComp,
      activeIncidents: incidents,
    });
  });

  const totalIncidents = components.reduce((n, c) => n + c.activeIncidents.length, 0);
  const isOp = components.every(c => c.status === 'operational');
  const description = isOp ? 'All Regions Operational' : `${totalIncidents} active incident(s)`;
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

module.exports = { fetchAuth0Status };
