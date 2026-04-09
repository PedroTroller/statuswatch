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
  if (!data || (data.status == null && data.indicator === undefined))
    throw new Error('Invalid cache response');
  // Normalize pre-migration cache files that still carry `indicator` instead of `status`.
  if (data.status == null) {
    const INDICATOR_TO_STATUS = {
      none:        'operational',
      maintenance: 'under_maintenance',
      minor:       'degraded_performance',
      major:       'partial_outage',
      critical:    'major_outage',
    };
    data.status = INDICATOR_TO_STATUS[data.indicator] ?? 'operational';
  }
  return data;
}

if (typeof module !== 'undefined') {
  module.exports = { fetchFromCache };
}
