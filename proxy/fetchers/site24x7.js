'use strict';

const { Incident }  = require('../../common/value-objects/incident.js');
const { ComponentStatus } = require('../../common/value-objects/component-status.js');
const { ServiceStatus }   = require('../../common/value-objects/service-status.js');
const { safeJson, _distributeIncidents } = require('./_helpers.js');

// StatusIQ (Zoho/Site24x7): single endpoint at {apiBase}/sp/api/u/summary_details.
// Component and overall status are integers:
//   1=Operational, 2=Informational, 3=Degraded Performance,
//   4=Under Maintenance, 5=Partial Outage, 6=Major Outage.
// Active incidents live in data.active_incident_details.
// Component rows with is_group:true are skipped (they're category headers).

const STATUS_MAP = {
  1: 'operational',
  2: 'operational',
  3: 'degraded_performance',
  4: 'under_maintenance',
  5: 'partial_outage',
  6: 'major_outage',
};

async function fetchSite24x7Status(service) {
  const res = await fetch(`${service.statusPageUrl}/sp/api/u/summary_details`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await safeJson(res);
  if (body?.code !== 0 || !body?.data) throw new Error('Invalid StatusIQ response');

  const data = body.data;

  const incidents = (data.active_incident_details ?? []).map(i => new Incident({
    id:        String(i.enc_incident_id ?? i.id ?? 'unknown'),
    name:      i.title ?? i.display_name ?? 'Incident',
    url: `${service.statusPageUrl}/#/incidents/${i.enc_incident_id ?? ''}`,
    impact:    null,
  }));

  const rawComponents = (data.current_status ?? [])
    .filter(c => !c.is_group)
    .map(c => new ComponentStatus({
      id:     String(c.enc_component_id),
      name:   c.display_name,
      status: STATUS_MAP[c.component_status] ?? 'operational',
    }));

  const components = _distributeIncidents(rawComponents, incidents);

  const overallCode   = data.statuspage_details?.status ?? 1;
  const overallStatus = STATUS_MAP[overallCode] ?? 'operational';
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

module.exports = { fetchSite24x7Status };
