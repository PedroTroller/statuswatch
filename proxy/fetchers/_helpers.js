'use strict';

const { Component } = require('../../common/value-objects/component.js');

// Parses a response as JSON, returning null if the body is not valid JSON
// (e.g. an HTML error page returned with HTTP 200).
async function safeJson(res) {
  try { return await res.json(); } catch { return null; }
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
    return [new Component({ id: 'service', name: 'Service', status: fallbackStatus, activeIncidents: incidents })];
  }
  const nonOp = components.filter(c => c.status !== 'operational');
  const targets = nonOp.length > 0 ? nonOp : components;
  const targetIds = new Set(targets.map(c => c.id));
  return components.map(c =>
    targetIds.has(c.id)
      ? new Component({ id: c.id, name: c.name, status: c.status, activeIncidents: incidents })
      : c
  );
}

module.exports = { safeJson, _indicatorToStatus, _distributeIncidents };
