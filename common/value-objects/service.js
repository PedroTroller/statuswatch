// common/value-objects/service.js — value object representing a tracked external service.
//
// Shared between the proxy (Node.js), tests, and browser extensions.
// Works as both a CommonJS module (require) and a browser global (importScripts).
//
// Service.status is always derived from the worst status across its components —
// it is never supplied at construction time. Severity ordering comes from Status.level.
// Service.activeIncidents is the merge of all components' activeIncidents arrays.

'use strict';

// In Node.js (proxy and tests): load dependencies from adjacent modules.
// In browser extensions: globals are loaded via importScripts in order:
//   status.js → incident.js → component.js → service.js
if (typeof module !== 'undefined') {
  var { Component }               = require('./component.js'); // eslint-disable-line no-var
  var { Status, statusFromValue } = require('./status.js');    // eslint-disable-line no-var
}

// Returns the worst Status entry across a list of Component instances.
// Defaults to Status.OPERATIONAL when the list is empty (no known degradation).
function worstStatus(components) {
  let worst = Status.OPERATIONAL;
  for (const c of components) {
    const s = statusFromValue(c.status);
    if (s !== null && s.level > worst.level) worst = s;
  }
  return worst;
}

class Service {
  constructor({
    id,
    name,
    description,
    pageUrl,
    relatedDomains = [],
    searchAliases  = [],
    fetchedAt      = null,
    fetchedFailed  = false,
    components     = [],
  }) {
    if (typeof id !== 'string' || id === '')
      throw new TypeError(`Service id must be a non-empty string, got ${JSON.stringify(id)}`);
    if (typeof name !== 'string' || name === '')
      throw new TypeError(`Service name must be a non-empty string, got ${JSON.stringify(name)}`);
    if (typeof description !== 'string')
      throw new TypeError(`Service description must be a string, got ${JSON.stringify(description)}`);
    try { new URL(pageUrl); } catch {
      throw new TypeError(`Service pageUrl must be a valid URL, got ${JSON.stringify(pageUrl)}`);
    }
    if (!Array.isArray(relatedDomains) || relatedDomains.some(d => typeof d !== 'string'))
      throw new TypeError('Service relatedDomains must be an array of strings');
    if (!Array.isArray(searchAliases) || searchAliases.some(a => typeof a !== 'string'))
      throw new TypeError('Service searchAliases must be an array of strings');
    if (fetchedAt !== null &&
        (typeof fetchedAt !== 'string' || Number.isNaN(new Date(fetchedAt).getTime())))
      throw new TypeError(`Service fetchedAt must be a valid ISO date string or null, got ${JSON.stringify(fetchedAt)}`);
    if (typeof fetchedFailed !== 'boolean')
      throw new TypeError(`Service fetchedFailed must be a boolean, got ${JSON.stringify(fetchedFailed)}`);
    if (!Array.isArray(components) || components.some(c => !(c instanceof Component)))
      throw new TypeError('Service components must be an array of Component instances');

    this.id             = id;
    this.name           = name;
    this.description    = description;
    this.pageUrl        = pageUrl;
    this.relatedDomains = Object.freeze([...relatedDomains]);
    this.searchAliases  = Object.freeze([...searchAliases]);
    this.fetchedAt      = fetchedAt;
    this.fetchedFailed  = fetchedFailed;
    this.components      = Object.freeze([...components]);
    this.status          = worstStatus(this.components);
    this.activeIncidents = Object.freeze([
      ...new Map(
        this.components.flatMap(c => c.activeIncidents).map(i => [i.shortlink, i])
      ).values(),
    ]);
    Object.freeze(this);
  }
}

// CommonJS export for Node.js (proxy and tests).
// In browser (importScripts), declarations are globals — no export needed.
if (typeof module !== 'undefined') {
  module.exports = { Service };
}
