// common/cache-reader.js — reads a service's pre-built status from the GitHub Pages cache.
//
// Dual-env: works as a CJS module (require) in Node.js and as a browser global
// via importScripts. In browser: GITHUB_PAGES_BASE is declared in config.js,
// which must be loaded before this file.

'use strict';

// Component-tracking services use "parentId__componentId" as their id.
// We only need the parent's cached file.
async function fetchFromCache(service) {
  const cacheId = service.id.split('__')[0];
  const res = await fetch(`${GITHUB_PAGES_BASE}/services/${cacheId}.json`);
  if (!res.ok) throw new Error(`Cache returned ${res.status}`);
  const data = await res.json();
  if (!data || data.indicator === undefined) throw new Error('Invalid cache response');
  return data;
}

// Maps a component status string to the indicator scale used by the extension.
function componentStatusToIndicator(status) {
  switch (status) {
    case 'operational':          return 'none';
    case 'degraded_performance': return 'minor';
    case 'partial_outage':       return 'major';
    case 'major_outage':         return 'critical';
    case 'under_maintenance':    return 'maintenance';
    default:                     return null;
  }
}

if (typeof module !== 'undefined') {
  module.exports = { fetchFromCache, componentStatusToIndicator };
}
