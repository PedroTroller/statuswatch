// common/value-objects/status.js — severity-ordered status enum for services and components.
//
// Shared between the proxy (Node.js), tests, and browser extensions.
// Works as both a CommonJS module (require) and a browser global (importScripts).

'use strict';

// Each entry is a frozen Status instance with a string `value` and a numeric `level`.
// Higher level = more severe. Levels are unique and contiguous (0–4).
class Status {
  constructor(value, level) {
    this.value = value;
    this.level = level;
    Object.freeze(this);
  }
}

const StatusEnum = Object.freeze({
  OPERATIONAL:          new Status('operational',          0),
  UNDER_MAINTENANCE:    new Status('under_maintenance',    1),
  DEGRADED_PERFORMANCE: new Status('degraded_performance', 2),
  PARTIAL_OUTAGE:       new Status('partial_outage',       3),
  MAJOR_OUTAGE:         new Status('major_outage',         4),
});

// O(1) lookup map built once from StatusEnum entries.
const _BY_VALUE = Object.freeze(
  Object.fromEntries(Object.values(StatusEnum).map(s => [s.value, s]))
);

// Returns the StatusEnum entry for the given string value, or null if not recognized.
function statusFromValue(value) {
  return _BY_VALUE[value] ?? null;
}

// CommonJS export for Node.js (proxy and tests).
// In browser (importScripts), declarations are globals — no export needed.
if (typeof module !== 'undefined') {
  module.exports = { Status, StatusEnum, statusFromValue };
}
