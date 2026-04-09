// common/value-objects/component-status.js — value object representing a single service component.
//
// Shared between the proxy (Node.js), tests, and browser extensions.
// Works as both a CommonJS module (require) and a browser global (importScripts).

'use strict';

// In Node.js (proxy and tests): load dependencies from adjacent modules.
// In browser extensions: globals are loaded via importScripts in order:
//   status.js → incident.js → component-status.js
if (typeof module !== 'undefined') {
  var { StatusEnum, statusFromValue } = require('./status.js');  // eslint-disable-line no-var
  var { Incident }                = require('./incident.js'); // eslint-disable-line no-var
}

// Derived from StatusEnum so it stays in sync with the single source of truth.
// Platform-independent: fetchers map platform-specific strings
// (e.g. 'operational', 'major_outage') to these values at fetch time.
const COMPONENT_STATUSES = Object.freeze(Object.values(StatusEnum).map(s => s.value));

class ComponentStatus {
  constructor({ id, name, status, activeIncidents = [] }) {
    if (typeof id !== 'string' || id === '')
      throw new TypeError(`ComponentStatus id must be a non-empty string, got ${JSON.stringify(id)}`);
    if (typeof name !== 'string' || name === '')
      throw new TypeError(`ComponentStatus name must be a non-empty string, got ${JSON.stringify(name)}`);
    if (statusFromValue(status) === null)
      throw new TypeError(`ComponentStatus status must be one of [${COMPONENT_STATUSES.join(', ')}], got ${JSON.stringify(status)}`);
    if (!Array.isArray(activeIncidents) || activeIncidents.some(i => !(i instanceof Incident)))
      throw new TypeError('ComponentStatus activeIncidents must be an array of Incident instances');

    this.id              = id;
    this.name            = name;
    this.status          = status;
    this.activeIncidents = Object.freeze([...activeIncidents]);
    Object.freeze(this);
  }
}

// CommonJS export for Node.js (proxy and tests).
// In browser (importScripts), declarations are globals — no export needed.
if (typeof module !== 'undefined') {
  module.exports = { ComponentStatus, COMPONENT_STATUSES };
}
