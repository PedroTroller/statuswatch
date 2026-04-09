// common/value-objects/incident.js — value object representing an active incident.
//
// Shared between the proxy (Node.js), tests, and browser extensions.
// Works as both a CommonJS module (require) and a browser global (importScripts).

'use strict';

class Incident {
  constructor({ id = null, name, shortlink, impact = null }) {
    if (id !== null && (typeof id !== 'string' || id === ''))
      throw new TypeError(`Incident id must be a non-empty string or null, got ${JSON.stringify(id)}`);
    if (typeof name !== 'string' || name === '')
      throw new TypeError(`Incident name must be a non-empty string, got ${JSON.stringify(name)}`);
    try { new URL(shortlink); } catch {
      throw new TypeError(`Incident shortlink must be a valid URL, got ${JSON.stringify(shortlink)}`);
    }
    if (impact !== null && typeof impact !== 'string')
      throw new TypeError(`Incident impact must be a string or null, got ${JSON.stringify(impact)}`);

    this.id        = id;
    this.name      = name;
    this.shortlink = shortlink;
    this.impact    = impact;
    Object.freeze(this);
  }
}

// CommonJS export for Node.js (proxy and tests).
// In browser (importScripts), declarations are globals — no export needed.
if (typeof module !== 'undefined') {
  module.exports = { Incident };
}
