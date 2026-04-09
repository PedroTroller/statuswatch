// common/value-objects/status.js — severity-ordered status enum for services and components.
//
// Shared between the proxy (Node.js), tests, and browser extensions.
// Works as both a CommonJS module (require) and a browser global (importScripts).

'use strict';

// Each entry is a frozen object with a string `value` and a numeric `level`.
// Higher level = more severe. Levels are unique and contiguous (0–4).
const Status = Object.freeze({
  OPERATIONAL:          Object.freeze({ value: 'operational',          level: 0 }),
  UNDER_MAINTENANCE:    Object.freeze({ value: 'under_maintenance',    level: 1 }),
  DEGRADED_PERFORMANCE: Object.freeze({ value: 'degraded_performance', level: 2 }),
  PARTIAL_OUTAGE:       Object.freeze({ value: 'partial_outage',       level: 3 }),
  MAJOR_OUTAGE:         Object.freeze({ value: 'major_outage',         level: 4 }),
});

// O(1) lookup map built once from Status entries.
const _BY_VALUE = Object.freeze(
  Object.fromEntries(Object.values(Status).map(s => [s.value, s]))
);

// Returns the Status entry for the given string value, or null if not recognized.
function statusFromValue(value) {
  return _BY_VALUE[value] ?? null;
}

// CommonJS export for Node.js (proxy and tests).
// In browser (importScripts), declarations are globals — no export needed.
if (typeof module !== 'undefined') {
  module.exports = { Status, statusFromValue };
}
