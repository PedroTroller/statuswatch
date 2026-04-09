// common/value-objects/service-status.js — value object representing a tracked external service.
//
// Shared between the proxy (Node.js), tests, and browser extensions.
// Works as both a CommonJS module (require) and a browser global (importScripts).
//
// ServiceStatus.status is always derived from the worst status across its components —
// it is never supplied at construction time. Severity ordering comes from StatusEnum.level.
// ServiceStatus.activeIncidents is the merge of all components' activeIncidents arrays.

'use strict';

// In Node.js (proxy and tests): load dependencies from adjacent modules.
// In browser extensions: globals are loaded via importScripts in order:
//   status.js → incident.js → component-status.js → service-status.js
if (typeof module !== 'undefined') {
  var { ComponentStatus }         = require('./component-status.js'); // eslint-disable-line no-var
  var { StatusEnum, statusFromValue } = require('./status.js');           // eslint-disable-line no-var
}

// Returns the worst StatusEnum entry across a list of ComponentStatus instances.
// Defaults to StatusEnum.OPERATIONAL when the list is empty (no known degradation).
function worstStatus(components) {
  let worst = StatusEnum.OPERATIONAL;
  for (const c of components) {
    const s = statusFromValue(c.status);
    if (s !== null && s.level > worst.level) worst = s;
  }
  return worst;
}

class ServiceStatus {
  constructor({
    id,
    name,
    description,
    statusPageUrl,
    relatedDomains = [],
    searchAliases  = [],
    fetchedAt      = null,
    fetchedFailed  = false,
    components     = [],
  }) {
    if (typeof id !== 'string' || id === '')
      throw new TypeError(`ServiceStatus id must be a non-empty string, got ${JSON.stringify(id)}`);
    if (typeof name !== 'string' || name === '')
      throw new TypeError(`ServiceStatus name must be a non-empty string, got ${JSON.stringify(name)}`);
    if (typeof description !== 'string')
      throw new TypeError(`ServiceStatus description must be a string, got ${JSON.stringify(description)}`);
    try { new URL(statusPageUrl); } catch {
      throw new TypeError(`ServiceStatus statusPageUrl must be a valid URL, got ${JSON.stringify(statusPageUrl)}`);
    }
    if (!Array.isArray(relatedDomains) || relatedDomains.some(d => typeof d !== 'string'))
      throw new TypeError('ServiceStatus relatedDomains must be an array of strings');
    if (!Array.isArray(searchAliases) || searchAliases.some(a => typeof a !== 'string'))
      throw new TypeError('ServiceStatus searchAliases must be an array of strings');
    if (fetchedAt !== null &&
        (typeof fetchedAt !== 'string' || Number.isNaN(new Date(fetchedAt).getTime())))
      throw new TypeError(`ServiceStatus fetchedAt must be a valid ISO date string or null, got ${JSON.stringify(fetchedAt)}`);
    if (typeof fetchedFailed !== 'boolean')
      throw new TypeError(`ServiceStatus fetchedFailed must be a boolean, got ${JSON.stringify(fetchedFailed)}`);
    if (!Array.isArray(components) || components.some(c => !(c instanceof ComponentStatus)))
      throw new TypeError('ServiceStatus components must be an array of ComponentStatus instances');

    this.id             = id;
    this.name           = name;
    this.description    = description;
    this.statusPageUrl        = statusPageUrl;
    this.relatedDomains = Object.freeze([...relatedDomains]);
    this.searchAliases  = Object.freeze([...searchAliases]);
    this.fetchedAt      = fetchedAt;
    this.fetchedFailed  = fetchedFailed;
    this.components      = Object.freeze([...components]);
    this.status          = worstStatus(this.components);
    this.activeIncidents = Object.freeze([
      ...new Map(
        this.components.flatMap(c => c.activeIncidents).map(i => [i.url, i])
      ).values(),
    ]);
    Object.freeze(this);
  }
}

// CommonJS export for Node.js (proxy and tests).
// In browser (importScripts), declarations are globals — no export needed.
if (typeof module !== 'undefined') {
  module.exports = { ServiceStatus };
}
