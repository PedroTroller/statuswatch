'use strict';

const { ComponentStatus } = require('../../common/value-objects/component-status.js');

// Parses a response as JSON, returning null if the body is not valid JSON
// (e.g. an HTML error page returned with HTTP 200).
async function safeJson(res) {
  try { return await res.json(); } catch { return null; }
}

// Reads a response as JSON while keeping the raw body, so that a validation
// failure can report what was actually served. A status page that has migrated
// off its previous platform typically answers /api/v2/*.json with an HTML page
// and HTTP 200, which a bare `Invalid status response` does not convey.
async function jsonWithBody(res) {
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { /* not JSON: data stays null */ }
  return { data, text, contentType: res.headers.get('content-type') ?? 'unknown' };
}

// One-line description of a fetched body, for use in error messages.
function _describeBody({ text, contentType }) {
  const excerpt = text.trim().replace(/\s+/g, ' ').slice(0, 200);
  return `content-type=${contentType}, ${text.length} bytes, body=${excerpt || '(empty)'}`;
}

// Describes a non-2xx response for an error message. A 403 from a WAF and a 403
// from the application look identical without the body: the challenge page is
// what tells them apart.
async function _describeResponse(res) {
  try {
    const text        = await res.text();
    const contentType = res.headers.get('content-type') ?? 'unknown';
    return _describeBody({ text, contentType });
  } catch {
    return 'body unavailable';
  }
}

// Maps an old-style indicator string to a component-status string.
// Used by fetchers that compute an overall indicator before building components
// (e.g. to create a synthetic component when no component list is available).
function _indicatorToStatus(indicator) {
  switch (indicator) {
    case 'none':        return 'operational';
    case 'maintenance': return 'under_maintenance';
    case 'minor':       return 'degraded_performance';
    case 'major':       return 'partial_outage';
    case 'critical':    return 'major_outage';
    default:            return 'degraded_performance';
  }
}

// Distributes service-level incidents across components.
// Attaches all incidents to every non-operational component.
// If every component is operational (or the list is empty), attaches to all components.
// If components is empty and incidents exist, returns a single synthetic component
// that carries the incidents with the given fallback status.
function _distributeIncidents(components, incidents, fallbackStatus = 'degraded_performance') {
  if (incidents.length === 0) return components;
  if (components.length === 0) {
    return [new ComponentStatus({ id: 'service', name: 'Service', status: fallbackStatus, activeIncidents: incidents })];
  }
  const nonOp = components.filter(c => c.status !== 'operational');
  const targets = nonOp.length > 0 ? nonOp : components;
  const targetIds = new Set(targets.map(c => c.id));
  return components.map(c =>
    targetIds.has(c.id)
      ? new ComponentStatus({ id: c.id, name: c.name, status: c.status, activeIncidents: incidents })
      : c
  );
}

module.exports = { safeJson, jsonWithBody, _describeBody, _describeResponse, _indicatorToStatus, _distributeIncidents };
