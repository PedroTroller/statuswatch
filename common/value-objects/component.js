// common/value-objects/component.js — value object representing a single service component.
//
// Shared between the proxy (Node.js), tests, and browser extensions.
// Works as both a CommonJS module (require) and a browser global (importScripts).

'use strict';

// In Node.js (proxy and tests): load dependencies from adjacent modules.
// In browser extensions: globals are loaded via importScripts in order:
//   status.js → incident.js → component.js
if (typeof module !== 'undefined') {
  var { Status, statusFromValue } = require('./status.js');  // eslint-disable-line no-var
  var { Incident }                = require('./incident.js'); // eslint-disable-line no-var
}

// Derived from Status so it stays in sync with the single source of truth.
// Platform-independent: fetchers map platform-specific strings
// (e.g. 'operational', 'major_outage') to these values at fetch time.
const COMPONENT_STATUSES = Object.freeze(Object.values(Status).map(s => s.value));

class Component {
  constructor({ id, name, status, activeIncidents = [] }) {
    if (typeof id !== 'string' || id === '')
      throw new TypeError(`Component id must be a non-empty string, got ${JSON.stringify(id)}`);
    if (typeof name !== 'string' || name === '')
      throw new TypeError(`Component name must be a non-empty string, got ${JSON.stringify(name)}`);
    if (statusFromValue(status) === null)
      throw new TypeError(`Component status must be one of [${COMPONENT_STATUSES.join(', ')}], got ${JSON.stringify(status)}`);
    if (!Array.isArray(activeIncidents) || activeIncidents.some(i => !(i instanceof Incident)))
      throw new TypeError('Component activeIncidents must be an array of Incident instances');

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
  module.exports = { Component, COMPONENT_STATUSES };
}
