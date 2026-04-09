// fetchers.js — platform-specific status fetchers.
//
// No Chrome API dependencies; safe to importScripts() in the service worker
// and to require() in Node.js tests (Node 18+ for native fetch).

'use strict';

// Parses a response as JSON, returning null if the body is not valid JSON
// (e.g. an HTML error page returned with HTTP 200).
async function safeJson(res) {
  try { return await res.json(); } catch { return null; }
}

// Common shape returned by every fetcher on success.
// Errors are recorded by pollService in background.js, not here.
function makeResult(indicator, description, components = [], activeIncidents = []) {
  return { indicator, description, components, activeIncidents, lastFetched: Date.now(), error: null };
}

async function fetchStatuspageStatus(service) {
  const [statusRes, componentsRes, incidentsRes] = await Promise.all([
    fetch(`${service.apiBase}/status.json`),
    fetch(`${service.apiBase}/components.json`),
    fetch(`${service.apiBase}/incidents/unresolved.json`),
  ]);

  if (!statusRes.ok)     throw new Error(`Status API returned ${statusRes.status}`);
  if (!componentsRes.ok) throw new Error(`Components API returned ${componentsRes.status}`);

  const statusData     = await safeJson(statusRes);
  const componentsData = await safeJson(componentsRes);
  const incidentsData  = incidentsRes.ok ? await safeJson(incidentsRes) : null;

  if (!statusData?.status?.indicator) throw new Error('Invalid status response');

  const components = (componentsData?.components ?? [])
    .filter(c => !c.group_id)
    .map(c => ({ id: c.id, name: c.name, status: c.status }));

  const activeIncidents = (incidentsData?.incidents ?? []).map(i => ({
    id:        i.id,
    name:      i.name,
    shortlink: i.shortlink,
    impact:    i.impact,
  }));

  return makeResult(statusData.status.indicator, statusData.status.description, components, activeIncidents);
}

// incident.io: same /api/v2/status.json and /api/v2/components.json as
// Statuspage.io, but no /api/v2/incidents/unresolved.json — only
// /api/v2/incidents.json (all incidents). Filter resolved ones client-side.
// Some instances return an HTML page (HTTP 200) for that endpoint — handled
// gracefully by safeJson returning null.
async function fetchIncidentioStatus(service) {
  const [statusRes, componentsRes, incidentsRes] = await Promise.all([
    fetch(`${service.apiBase}/status.json`),
    fetch(`${service.apiBase}/components.json`),
    fetch(`${service.apiBase}/incidents.json`).catch(() => null),
  ]);

  if (!statusRes.ok)     throw new Error(`Status API returned ${statusRes.status}`);
  if (!componentsRes.ok) throw new Error(`Components API returned ${componentsRes.status}`);

  const statusData     = await safeJson(statusRes);
  const componentsData = await safeJson(componentsRes);
  const incidentsData  = incidentsRes?.ok ? await safeJson(incidentsRes) : null;

  if (!statusData?.status?.indicator) throw new Error('Invalid status response');

  const components = (componentsData?.components ?? [])
    .filter(c => !c.group_id)
    .map(c => ({ id: c.id, name: c.name, status: c.status }));

  const activeIncidents = (incidentsData?.incidents ?? [])
    .filter(i => i.status !== 'resolved')
    .map(i => ({
      id:        i.id,
      name:      i.name,
      shortlink: `${service.pageUrl}/incidents/${i.id}`,
      impact:    i.impact,
    }));

  return makeResult(statusData.status.indicator, statusData.status.description, components, activeIncidents);
}

// Slack status values: "ok" | "active" | "broken"
// https://slack-status.com/api/v1.0.0/current
const SLACK_STATUS_MAP = {
  ok:     { indicator: 'none',     description: 'All Systems Operational' },
  active: { indicator: 'minor',    description: 'Active Incident' },
  broken: { indicator: 'critical', description: 'Service Disruption' },
};

async function fetchSlackStatus(service) {
  const res = await fetch(`${service.apiBase}/current`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();

  const mapped = SLACK_STATUS_MAP[data.status]
    ?? { indicator: 'minor', description: `Status: ${data.status}` };

  return makeResult(mapped.indicator, mapped.description);
}

// UptimeRobot status pages: /api/getMonitorList/{key} — the key segment is not
// validated server-side; any non-empty string works. Binary up/down model:
//   statusClass "success" → up, "danger" → down, "black" → paused.
// Aggregate indicator: none (all up) / major (some down) / critical (all down).
async function fetchUptimeRobotStatus(service) {
  const res = await fetch(`${service.apiBase}/getMonitorList/x`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await safeJson(res);
  if (!data?.statistics?.counts) throw new Error('Invalid UptimeRobot response');

  const { up: _up, down, total } = data.statistics.counts;
  const indicator = down === 0     ? 'none'
                  : down === total ? 'critical'
                  :                  'major';

  const description = data.statistics.count_result
    ?? (down === 0 ? 'All Systems Operational' : `${down} of ${total} monitors down`);

  const monitors = data.psp?.monitors ?? data.data ?? [];
  const components = monitors.map(m => ({
    id:     String(m.monitorId),
    name:   m.name,
    status: m.statusClass === 'success' ? 'operational'
          : m.statusClass === 'danger'  ? 'major_outage'
          :                               'under_maintenance',
  }));

  return makeResult(indicator, description, components);
}

// status.io numeric status codes → our component status strings.
function _statusCodeToComponentStatus(code) {
  if (code <= 100) return 'operational';
  if (code <= 200) return 'under_maintenance';
  if (code <= 300) return 'degraded_performance';
  if (code <= 400) return 'partial_outage';
  return 'major_outage';
}

// status.io numeric status codes → our indicator scale.
function _statusCodeToIndicator(code) {
  if (code <= 100) return 'none';
  if (code <= 300) return 'minor';   // maintenance (200) or degraded (300)
  if (code <= 400) return 'major';   // partial outage (400)
  return 'critical';                 // major (500) or critical (600)
}

// status.io: single endpoint at api.status.io/1.0/status/{pageId}.
// The pageId is stored on the catalog entry as `pageId`.
async function fetchStatusioStatus(service) {
  const res = await fetch(`${service.apiBase}/status/${service.pageId}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await safeJson(res);
  if (!data?.result?.status_overall) throw new Error('Invalid status.io response');

  const { status_overall, status: comps, incidents } = data.result;

  const components = (comps ?? []).map(c => ({
    id:     c.id,
    name:   c.name,
    status: _statusCodeToComponentStatus(c.status_code),
  }));

  const activeIncidents = (incidents ?? []).map(i => ({
    id:        i.id,
    name:      i.name,
    shortlink: `${service.pageUrl}/incidents/${i.id}`,
    impact:    null,
  }));

  return makeResult(_statusCodeToIndicator(status_overall.status_code), status_overall.status ?? '', components, activeIncidents);
}

// Google Workspace status dashboard: polls /incidents.json (CORS-open, no auth).
// Active incidents have no `end` field. Indicator and components are derived
// from the worst status_impact across all active incidents.
const _GW_IMPACT_TO_INDICATOR = {
  SERVICE_OUTAGE:      'critical',
  SERVICE_DISRUPTION:  'major',
  SERVICE_INFORMATION: 'minor',
};
const _GW_IMPACT_TO_COMP_STATUS = {
  SERVICE_OUTAGE:      'major_outage',
  SERVICE_DISRUPTION:  'partial_outage',
  SERVICE_INFORMATION: 'degraded_performance',
};
const _GW_SEVERITY_RANK = { critical: 3, major: 2, minor: 1, none: 0 };

async function fetchGoogleIncidentDashboard(service) {
  const [incidentsRes, productsRes] = await Promise.all([
    fetch(`${service.apiBase}/incidents.json`),
    fetch(`${service.apiBase}/products.json`),
  ]);

  if (!incidentsRes.ok) throw new Error(`HTTP ${incidentsRes.status}`);
  const incidents = await safeJson(incidentsRes);
  if (!Array.isArray(incidents)) throw new Error('Invalid Google Workspace response');

  const productsData = productsRes.ok ? await safeJson(productsRes) : null;
  const allProducts  = productsData?.products ?? [];

  const active = incidents.filter(i => !i.end);

  // Worst indicator across all active incidents
  let indicator = 'none';
  for (const i of active) {
    const ind = _GW_IMPACT_TO_INDICATOR[i.status_impact] ?? 'minor';
    if (_GW_SEVERITY_RANK[ind] > _GW_SEVERITY_RANK[indicator]) indicator = ind;
  }

  // Per-product status from active incidents (worst impact wins per product)
  const byProduct = {};
  for (const i of active) {
    const compStatus = _GW_IMPACT_TO_COMP_STATUS[i.status_impact] ?? 'degraded_performance';
    for (const p of i.affected_products ?? []) {
      const cur = byProduct[p.id];
      if (!cur || _GW_SEVERITY_RANK[_GW_IMPACT_TO_INDICATOR[i.status_impact]] >
                  _GW_SEVERITY_RANK[_GW_IMPACT_TO_INDICATOR[cur._impact]]) {
        byProduct[p.id] = { id: p.id, name: p.title, status: compStatus, _impact: i.status_impact };
      }
    }
  }

  // All products as components, defaulting to operational
  const components = allProducts.map(p => ({
    id:     p.id,
    name:   p.title,
    status: byProduct[p.id]?.status ?? 'operational',
  }));

  const activeIncidents = active.map(i => ({
    id:        i.id,
    name:      i.affected_products?.length
                 ? i.affected_products.map(p => p.title).join(', ')
                 : (i.service_name ?? 'Incident'),
    shortlink: `${service.pageUrl}/${i.uri}`,
    impact:    i.status_impact,
  }));

  const description = active.length === 0
    ? 'All Systems Operational'
    : `${active.length} active incident${active.length > 1 ? 's' : ''}`;

  return makeResult(indicator, description, components, activeIncidents);
}

// Zendesk: custom status page with JSON:API endpoints.
//   /api/ssp/services.json                    — top-level service list (components)
//   /api/ssp/incidents.json?as_of_date={date} — incidents + incidentServices (included)
// Active incidents: resolvedAt === null. Active incidentServices: same.
// Component status inferred from active incidentServices (outage/degradation flags).
const ZENDESK_IMPACT_MAP = { critical: 'critical', major: 'critical', minor: 'minor' };
const ZENDESK_SEVERITY_RANK = { none: 0, minor: 1, major: 2, critical: 3 };

async function fetchZendeskStatus(service) {
  const today = new Date().toISOString().slice(0, 10);
  const [servicesRes, incidentsRes] = await Promise.all([
    fetch(`${service.apiBase}/api/ssp/services.json`),
    fetch(`${service.apiBase}/api/ssp/incidents.json?as_of_date=${today}`),
  ]);
  if (!servicesRes.ok)   throw new Error(`HTTP ${servicesRes.status}`);
  if (!incidentsRes.ok)  throw new Error(`HTTP ${incidentsRes.status}`);
  const servicesData  = await safeJson(servicesRes);
  const incidentsData = await safeJson(incidentsRes);
  if (!Array.isArray(servicesData?.data)) throw new Error('Invalid Zendesk response');

  // Active incidentServices: resolvedAt === null, grouped by serviceId
  const activeByService = {};
  for (const inc of incidentsData?.included ?? []) {
    if (inc.type !== 'incidentService' || inc.attributes.resolvedAt) continue;
    const sid = String(inc.attributes.serviceId);
    const cur = activeByService[sid];
    const worse = inc.attributes.outage || (!cur?.attributes.outage && inc.attributes.degradation);
    if (!cur || worse) activeByService[sid] = inc;
  }

  let indicator = 'none';
  const components = servicesData.data.map(s => {
    const inc = activeByService[String(s.id)];
    let status = 'operational';
    if (inc) {
      status = inc.attributes.outage ? 'major_outage' : 'degraded_performance';
      const ind = inc.attributes.outage ? 'critical' : 'minor';
      if (ZENDESK_SEVERITY_RANK[ind] > ZENDESK_SEVERITY_RANK[indicator]) indicator = ind;
    }
    return { id: String(s.id), name: s.attributes.name, status };
  });

  // Active incidents (resolvedAt === null) for incident list
  const activeIncidents = (incidentsData?.data ?? [])
    .filter(i => !i.attributes.resolvedAt)
    .map(i => ({
      id:        i.id,
      name:      i.attributes.name,
      shortlink: `${service.pageUrl}/incidents/${i.id}`,
      impact:    i.attributes.impact ?? null,
    }));

  // Also factor incident-level impact into indicator
  for (const i of activeIncidents) {
    const ind = ZENDESK_IMPACT_MAP[i.impact] ?? 'minor';
    if (ZENDESK_SEVERITY_RANK[ind] > ZENDESK_SEVERITY_RANK[indicator]) indicator = ind;
  }

  const description = indicator === 'none' ? 'All Systems Operational' : `${activeIncidents.length} active incident(s)`;
  return makeResult(indicator, description, components, activeIncidents);
}

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
  let indicator  = 'none';

  const components = regions.map(r => {
    let worstInd  = 'none';
    let worstComp = 'operational';
    for (const i of r.response?.incidents ?? []) {
      const m = AUTH0_STATUS_MAP[i.status] ?? { comp: 'degraded_performance', ind: 'minor' };
      if (AUTH0_SEVERITY_RANK[m.ind] > AUTH0_SEVERITY_RANK[worstInd]) {
        worstInd  = m.ind;
        worstComp = m.comp;
      }
    }
    if (AUTH0_SEVERITY_RANK[worstInd] > AUTH0_SEVERITY_RANK[indicator]) indicator = worstInd;
    return { id: r.region, name: `${r.region} (${r.environment})`, status: worstComp };
  });

  const activeIncidents = regions.flatMap(r =>
    (r.response?.incidents ?? [])
      .filter(i => i.status !== 'operational' && i.id)
      .map(i => ({
        id:        i.id,
        name:      i.name,
        shortlink: `${service.pageUrl}/incidents/${i.id}`,
        impact:    i.impact ?? null,
      }))
  );

  const description = indicator === 'none' ? 'All Regions Operational' : `${activeIncidents.length} active incident(s)`;
  return makeResult(indicator, description, components, activeIncidents);
}

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
  Maintenance:   { comp: 'under_maintenance',    ind: 'minor'    },
};

async function fetchStatuscastStatus(service) {
  const headers = { 'User-Agent': STATUSCAST_BROWSER_UA };
  const [statusRes, componentsRes, incidentsRes] = await Promise.all([
    fetch(`${service.apiBase}/status.json`,     { headers }),
    fetch(`${service.apiBase}/components.json`, { headers }),
    fetch(`${service.apiBase}/incidents.json`,  { headers }).catch(() => null),
  ]);

  if (!statusRes.ok)     throw new Error(`Status API returned ${statusRes.status}`);
  if (!componentsRes.ok) throw new Error(`Components API returned ${componentsRes.status}`);

  const statusData     = await safeJson(statusRes);
  const componentsData = await safeJson(componentsRes);
  const incidentsData  = incidentsRes?.ok ? await safeJson(incidentsRes) : [];

  if (!statusData?.Status) throw new Error('Invalid StatusCast response');

  const mapped    = STATUSCAST_STATUS_MAP[statusData.Status] ?? { comp: 'degraded_performance', ind: 'minor' };
  const indicator = mapped.ind;

  const components = (Array.isArray(componentsData) ? componentsData : [])
    .filter(c => c.Level === 1)
    .map(c => {
      const m = STATUSCAST_STATUS_MAP[c.CurrentStatus] ?? { comp: 'degraded_performance' };
      return { id: String(c.id), name: c.text, status: m.comp };
    });

  const activeIncidents = (Array.isArray(incidentsData) ? incidentsData : [])
    .filter(i => i.Status === 'InProgress')
    .map(i => ({
      id:        String(i.Id),
      name:      i.Title,
      shortlink: i.ShortUrl ?? `${service.pageUrl}`,
      impact:    i.IncidentType ?? null,
    }));

  const description = statusData.StatusText ?? (indicator === 'none' ? 'All Systems Operational' : '');
  return makeResult(indicator, description, components, activeIncidents);
}

// PagerDuty: their own status-page product. Two endpoints:
//   /api/services              — full service list (components); no current status field.
//   /api/posts?statuses[]=...  — active posts (investigating | detected).
// Component status is inferred: affected by an active post → degraded, else operational.
// Severity: "minor" → minor, "major" → critical.
const PD_SEVERITY_MAP = { minor: 'minor', major: 'critical' };
const PD_SEVERITY_RANK = { none: 0, minor: 1, major: 2, critical: 3 };

async function fetchPagerdutySatus(service) {
  const activeStatuses = 'statuses%5B%5D=investigating&statuses%5B%5D=detected';
  const [servicesRes, postsRes] = await Promise.all([
    fetch(`${service.apiBase}/api/services`),
    fetch(`${service.apiBase}/api/posts?${activeStatuses}&limit=500`),
  ]);
  if (!servicesRes.ok) throw new Error(`HTTP ${servicesRes.status}`);
  const servicesData = await safeJson(servicesRes);
  if (!Array.isArray(servicesData?.services)) throw new Error('Invalid PagerDuty response');

  const activePosts = postsRes.ok ? ((await safeJson(postsRes))?.posts ?? []) : [];

  const affectedIds = new Set(
    activePosts.flatMap(p => (p.incident_services ?? []).map(s => s.id))
  );

  let indicator = 'none';
  for (const p of activePosts) {
    const ind = PD_SEVERITY_MAP[p.current_post_severity_enum?.name] ?? 'minor';
    if (PD_SEVERITY_RANK[ind] > PD_SEVERITY_RANK[indicator]) indicator = ind;
  }

  const components = servicesData.services
    .filter(s => s.is_active)
    .map(s => ({
      id:     s.id,
      name:   s.display_name ?? s.name,
      status: affectedIds.has(s.id) ? 'degraded_performance' : 'operational',
    }));

  const activeIncidents = activePosts.map(p => ({
    id:        p.id,
    name:      p.title ?? p.id,
    shortlink: `${service.pageUrl}/posts/${p.id}`,
    impact:    p.current_post_severity_enum?.name ?? null,
  }));

  const description = indicator === 'none'
    ? 'All Systems Operational'
    : `${activePosts.length} active incident(s)`;

  return makeResult(indicator, description, components, activeIncidents);
}

// Algolia: custom React app. Status API at status.algolia.com/3/public/availability.
// Components are services; current status is the last entry in uptime_days.
// Status values use hyphens: "operational" | "degraded-performance" | "major-outage".
const ALGOLIA_STATUS_MAP = {
  'operational':         'operational',
  'degraded-performance':'degraded_performance',
  'major-outage':        'major_outage',
};

async function fetchAlgoliaStatus(service) {
  const [availRes, incidentsRes] = await Promise.all([
    fetch(`${service.apiBase}/3/public/availability`),
    fetch(`${service.apiBase}/3/public/incidents`).catch(() => null),
  ]);
  if (!availRes.ok) throw new Error(`HTTP ${availRes.status}`);
  const availData    = await safeJson(availRes);
  const incidentsData = incidentsRes?.ok ? await safeJson(incidentsRes) : [];
  if (!availData || typeof availData !== 'object') throw new Error('Invalid Algolia response');

  const services = Object.values(availData);
  let indicator = 'none';
  const components = services.map(s => {
    const last   = s.uptime_days?.[s.uptime_days.length - 1];
    const status = ALGOLIA_STATUS_MAP[last?.status] ?? 'operational';
    const ind    = componentStatusToIndicator(status) ?? 'none';
    if (_GW_SEVERITY_RANK[ind] > _GW_SEVERITY_RANK[indicator]) indicator = ind;
    return { id: s.type, name: s.name, status };
  });

  const activeIncidents = (Array.isArray(incidentsData) ? incidentsData : [])
    .filter(i => !i.resolved_at)
    .map(i => ({
      id:        String(i.id),
      name:      i.name ?? i.title ?? 'Incident',
      shortlink: `${service.pageUrl}/incidents/${i.id}`,
      impact:    i.current_severity ?? null,
    }));

  const description = indicator === 'none' ? 'All Systems Operational'
    : `${activeIncidents.length || 'Active'} incident(s)`;

  return makeResult(indicator, description, components, activeIncidents);
}

// Heroku: custom Rails API at status.heroku.com/api/v4/current-status.
// System status: "green" | "yellow" | "red". Worst system wins for indicator.
const HEROKU_STATUS_MAP = {
  green:  { comp: 'operational',          ind: 'none'     },
  yellow: { comp: 'degraded_performance', ind: 'minor'    },
  red:    { comp: 'major_outage',         ind: 'critical' },
};
const HEROKU_SEVERITY = { none: 0, minor: 1, major: 2, critical: 3 };

async function fetchHerokuStatus(service) {
  const res = await fetch(`${service.apiBase}/api/v4/current-status`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await safeJson(res);
  if (!Array.isArray(data?.status)) throw new Error('Invalid Heroku response');

  let indicator = 'none';
  const components = data.status.map(s => {
    const mapped = HEROKU_STATUS_MAP[s.status] ?? { comp: 'degraded_performance', ind: 'minor' };
    if (HEROKU_SEVERITY[mapped.ind] > HEROKU_SEVERITY[indicator]) indicator = mapped.ind;
    return { id: s.system.toLowerCase(), name: s.system, status: mapped.comp };
  });

  const description = indicator === 'none' ? 'All Systems Operational' : `${indicator} issue`;

  const activeIncidents = (data.incidents ?? []).map(i => ({
    id:        String(i.id),
    name:      i.title ?? i.id,
    shortlink: `${service.pageUrl}/incidents/${i.id}`,
    impact:    null,
  }));

  return makeResult(indicator, description, components, activeIncidents);
}

// Stripe: custom status page at status.stripe.com/current/full.
// UptimeStatus: "up" | "degraded" | "down". Components from uptimeData[].
// warning===null means operational; any non-null warning means degraded.
const STRIPE_UPTIME_MAP = {
  up:       'none',
  degraded: 'minor',
  down:     'critical',
};

async function fetchStripeStatus(service) {
  const res = await fetch(`${service.apiBase}/current/full`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await safeJson(res);
  if (!data?.UptimeStatus) throw new Error('Invalid Stripe response');

  const indicator   = STRIPE_UPTIME_MAP[data.UptimeStatus] ?? 'major';
  const description = data.message ?? '';

  const components = (data.uptimeData ?? []).map(u => ({
    id:     u.key,
    name:   u.title,
    status: u.warning == null ? 'operational' : 'degraded_performance',
  }));

  return makeResult(indicator, description, components);
}

// ── SorryApp ─────────────────────────────────────────────────────────────────
// Used by Postmark and other services on the sorryapp.com platform.
// Endpoints: /api/v1/status, /api/v1/components, /api/v1/notices

const SORRYAPP_PAGE_STATE_MAP = {
  operational: 'none',
  degraded:    'minor',
  outage:      'critical',
  maintenance: 'minor',
};

const SORRYAPP_COMP_STATE_MAP = {
  operational: 'operational',
  degraded:    'degraded_performance',
  outage:      'major_outage',
  maintenance: 'under_maintenance',
};

async function fetchSorryappStatus(service) {
  const base = service.apiBase;
  const [statusRes, compsRes, noticesRes] = await Promise.all([
    fetch(`${base}/api/v1/status`),
    fetch(`${base}/api/v1/components`),
    fetch(`${base}/api/v1/notices`),
  ]);
  if (!statusRes.ok) throw new Error(`HTTP ${statusRes.status}`);
  const [statusData, compsData, noticesData] = await Promise.all([
    safeJson(statusRes),
    safeJson(compsRes),
    safeJson(noticesRes),
  ]);
  if (!statusData?.page) throw new Error('Invalid SorryApp response');

  const indicator   = SORRYAPP_PAGE_STATE_MAP[statusData.page.state] ?? 'major';
  const description = statusData.page.state_text ?? '';

  const components = (compsData?.components ?? [])
    .filter(c => c.parent_id === null)
    .map(c => ({
      id:     String(c.id),
      name:   c.name,
      status: SORRYAPP_COMP_STATE_MAP[c.state] ?? 'unknown',
    }));

  const activeIncidents = (noticesData?.notices ?? [])
    .filter(n => n.ended_at === null)
    .map(n => ({ name: n.subject, shortlink: n.url }));

  return makeResult(indicator, description, components, activeIncidents);
}

// ── AWS Health ────────────────────────────────────────────────────────────────
// Polls /public/currentevents — returns all active AWS service events worldwide.
// The response is UTF-16 encoded (with BOM); decoded via TextDecoder('utf-16').
//
// Event status codes: "1" = Investigating, "2" = Identified, "3" = Monitoring.
// All events in currentevents are active; status "3" (monitoring) is resolving.

const AWS_EVENT_STATUS_MAP = {
  '1': 'major',
  '2': 'major',
  '3': 'minor',
};

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
    return makeResult('none', 'All Services Operational');
  }

  // Worst-case indicator across all active events
  let indicator = 'minor';
  for (const ev of data) {
    const ind = AWS_EVENT_STATUS_MAP[ev.status] ?? 'major';
    if (ind === 'major') { indicator = 'major'; break; }
  }

  const description = data.length === 1
    ? `${data[0].service_name} — ${data[0].region_name}`
    : `${data.length} active events`;

  // Deduplicate by service-region for component list
  const seen = new Set();
  const components = [];
  for (const ev of data) {
    const key = `${ev.service}-${ev.region_name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    components.push({
      id:     key,
      name:   `${ev.service_name} — ${ev.region_name}`,
      status: 'partial_outage',
    });
  }

  const activeIncidents = data.map(ev => ({
    name:      ev.summary,
    shortlink: service.pageUrl,
  }));

  return makeResult(indicator, description, components, activeIncidents);
}

// Maps a component status string to our four-level indicator scale.
// Returns null for unknown statuses so callers can fall back gracefully.
function componentStatusToIndicator(status) {
  switch (status) {
    case 'operational':          return 'none';
    case 'degraded_performance': return 'minor';
    case 'partial_outage':       return 'major';
    case 'major_outage':         return 'critical';
    case 'under_maintenance':    return 'minor';
    default:                     return null;
  }
}

// Dispatches to the right fetcher based on service.type (required).
function fetchServiceStatus(service) {
  if (service.type === 'slack')         return fetchSlackStatus(service);
  if (service.type === 'incidentio')    return fetchIncidentioStatus(service);
  if (service.type === 'uptimerobot')   return fetchUptimeRobotStatus(service);
  if (service.type === 'statusio')      return fetchStatusioStatus(service);
  if (service.type === 'google') return fetchGoogleIncidentDashboard(service);
  if (service.type === 'zendesk')       return fetchZendeskStatus(service);
  if (service.type === 'auth0')         return fetchAuth0Status(service);
  if (service.type === 'statuscast')    return fetchStatuscastStatus(service);
  if (service.type === 'pagerduty')     return fetchPagerdutySatus(service);
  if (service.type === 'algolia')       return fetchAlgoliaStatus(service);
  if (service.type === 'heroku')        return fetchHerokuStatus(service);
  if (service.type === 'stripe')        return fetchStripeStatus(service);
  if (service.type === 'sorryapp')      return fetchSorryappStatus(service);
  if (service.type === 'awshealth')    return fetchAwsHealthStatus(service);
  return fetchStatuspageStatus(service);
}

// Export for Node.js (tests). In the service worker this file is loaded via
// importScripts(), where `module` is undefined and all declarations are globals.
if (typeof module !== 'undefined') {
  module.exports = {
    safeJson,
    fetchStatuspageStatus,
    fetchIncidentioStatus,
    fetchSlackStatus,
    fetchUptimeRobotStatus,
    fetchStatusioStatus,
    fetchGoogleIncidentDashboard,
    fetchZendeskStatus,
    fetchAuth0Status,
    fetchStatuscastStatus,
    fetchPagerdutySatus,
    fetchAlgoliaStatus,
    fetchHerokuStatus,
    fetchStripeStatus,
    fetchSorryappStatus,
    fetchAwsHealthStatus,
    fetchServiceStatus,
    componentStatusToIndicator,
  };
}
