// background.js — shared MV3 service worker logic for Status Pages extension
//
// Polling strategy: self-rescheduling one-time alarms via browser.alarms.
//   - All services green  → next poll in 30 s
//   - Any service degraded → next poll in 10 s
//     (Chrome enforces a ~30 s minimum for alarms in production builds;
//      in development the value is honored as-is.)
// A watchdog alarm fires every 5 minutes to restart any stalled poller.

importScripts('config.js');

const POLL_FAST_MS     = 10_000;
const POLL_FALLBACK_MS = 60_000;
// Extra buffer added on top of data.ttl when scheduling the next poll.
// Gives GitHub Pages a moment to finish deploying the new generation.
const POLL_GEN_BUFFER_MS = 2 * 60 * 1000;

// ─── Storage ────────────────────────────────────────────────────────────────

async function load() {
  const data = await browser.storage.local.get(['services', 'states']);
  return {
    services: data.services ?? [],
    states:   data.states   ?? {},
  };
}

async function save(updates) {
  return browser.storage.local.set(updates);
}

// ─── Catalog ─────────────────────────────────────────────────────────────────
//
// The catalog is fetched from the GitHub Pages cache (or local dev server) and
// stored in browser.storage.local with a 5-minute TTL — matching the cron interval.
// An in-memory variable avoids repeated storage reads within the same service
// worker lifetime (workers are killed ~30 s after going idle in MV3).

const CATALOG_TTL_MS = 5 * 60 * 1000;
let _catalog = null; // in-memory cache, reset on every service worker restart

async function getCatalog() {
  if (_catalog) return _catalog;

  const stored = await browser.storage.local.get(['catalog', 'catalogFetchedAt']);
  const age    = Date.now() - (stored.catalogFetchedAt ?? 0);

  if (stored.catalog && age < CATALOG_TTL_MS) {
    _catalog = stored.catalog;
    return _catalog;
  }

  try {
    const res = await fetch(`${GITHUB_PAGES_BASE}/catalog.json`);
    if (res.ok) {
      const data = await res.json();
      _catalog   = data.services ?? [];
      await browser.storage.local.set({ catalog: _catalog, catalogFetchedAt: Date.now() });
      return _catalog;
    }
  } catch { /* fall through to stale/empty */ }

  _catalog = stored.catalog ?? [];
  return _catalog;
}

// ─── Service management ─────────────────────────────────────────────────────

async function addService(service) {
  const { services, states } = await load();
  if (services.find(s => s.id === service.id)) return;
  await save({ services: [...services, service], states });
  pollService(service.id);
}

async function removeService(id) {
  const { services, states } = await load();
  const newStates = { ...states };
  delete newStates[id];
  await browser.alarms.clear(`poll_${id}`);
  await save({
    services: services.filter(s => s.id !== id),
    states:   newStates,
  });
  await refreshBadge(newStates);
}

async function setNotifications(id, enabled) {
  const { services } = await load();
  await save({
    services: services.map(s => s.id === id ? { ...s, notificationsEnabled: enabled } : s),
  });
}

// ─── Fetching — reads pre-built status from GitHub Pages cache ───────────────

function componentStatusToIndicator(status) {
  switch (status) {
    case 'operational':          return 'none';
    case 'degraded_performance': return 'minor';
    case 'partial_outage':       return 'major';
    case 'major_outage':         return 'critical';
    case 'under_maintenance':    return 'minor';
    default:                     return null;
  }
}

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

// ─── Dynamic icon ────────────────────────────────────────────────────────────
//
// Generates ImageData for the checkmark-in-circle icon in any fill color.
// Uses the same geometry as create-icons.js so they stay in sync.
// ImageData is available in MV3 service workers without a canvas.

const CK = { x1: 0.22, y1: 0.53, xm: 0.42, ym: 0.71, x2: 0.78, y2: 0.29 };

function _distSeg(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - x1, py - y1);
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function makeIconImageData(size, r, g, b) {
  const data = new Uint8ClampedArray(size * size * 4);
  const cx = size / 2, cy = size / 2;
  const outerR    = size / 2 - 1;
  const thickness = Math.max(1.8, size * 0.115);

  const x1 = CK.x1 * size, y1 = CK.y1 * size;
  const xm = CK.xm * size, ym = CK.ym * size;
  const x2 = CK.x2 * size, y2 = CK.y2 * size;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x + 0.5, py = y + 0.5;
      const idx = (y * size + x) * 4;

      const circleA = Math.max(0, Math.min(1, outerR - Math.hypot(px - cx, py - cy) + 0.7));
      if (circleA === 0) continue;

      const ckDist = Math.min(
        _distSeg(px, py, x1, y1, xm, ym),
        _distSeg(px, py, xm, ym, x2, y2)
      );
      const checkA = Math.max(0, Math.min(1, thickness / 2 - ckDist + 0.7));

      data[idx]     = Math.round(255 * checkA + r * (1 - checkA));
      data[idx + 1] = Math.round(255 * checkA + g * (1 - checkA));
      data[idx + 2] = Math.round(255 * checkA + b * (1 - checkA));
      data[idx + 3] = Math.round(circleA * 255);
    }
  }
  return new ImageData(data, size, size);
}

// Lazily built cache — regenerated after each service worker restart.
let _iconCache = null;

function iconCache() {
  if (_iconCache) return _iconCache;
  const mk = (r, g, b) => ({ 16: makeIconImageData(16, r, g, b), 32: makeIconImageData(32, r, g, b) });
  _iconCache = {
    ok:       mk(34,  197, 94),   // #22c55e  green
    minor:    mk(234, 179,  8),   // #eab308  yellow
    major:    mk(249, 115, 22),   // #f97316  orange
    critical: mk(239, 68,  68),   // #ef4444  red
    default:  mk(99,  102, 241),  // #6366f1  indigo
  };
  return _iconCache;
}

// Derive the worst status across all loaded service states.
// Returns 'ok' | 'minor' | 'major' | 'critical' | 'default' (no data yet).
function worstStatus(states) {
  const indicators = Object.values(states).map(s => s?.indicator).filter(Boolean);
  if (!indicators.length)                         return 'default';
  if (indicators.some(i => i === 'critical'))     return 'critical';
  if (indicators.some(i => i === 'major'))        return 'major';
  if (indicators.some(i => i === 'minor'))        return 'minor';
  return 'ok';
}

function updateActionIcon(states) {
  const key = worstStatus(states);
  browser.action.setIcon({ imageData: iconCache()[key] });
}

// ─── Badge ───────────────────────────────────────────────────────────────────

function countDegraded(states) {
  return Object.values(states).filter(s => s?.indicator && s.indicator !== 'none').length;
}

// Returns true if `host` matches `pattern`.
// Patterns starting with "*." match the base domain and all its subdomains.
function hostMatches(host, pattern) {
  if (pattern.startsWith('*.')) {
    const base = pattern.slice(2);
    return host === base || host.endsWith('.' + base);
  }
  return host === pattern;
}

// Returns the catalog entry that matches `url` (by status page host OR any
// relatedDomain) and is not yet tracked. Used to drive the "+" badge.
function findUntrackedCatalogEntry(url, services, catalog) {
  try {
    const host = new URL(url).host;
    return catalog.find(entry => {
      if (services.find(s => s.id === entry.id)) return false;
      if (new URL(entry.pageUrl).host === host) return true;
      return (entry.relatedDomains ?? []).some(p => hostMatches(host, p));
    }) ?? null;
  } catch {
    return null;
  }
}

// Set the badge for a specific tab: "+" if the tab is on an untracked catalog
// page, otherwise mirror the global degraded count.
async function updateTabBadge(tabId, url) {
  if (!url?.startsWith('http')) {
    browser.action.setBadgeText({ text: '', tabId });
    return;
  }
  const [{ services, states }, catalog] = await Promise.all([load(), getCatalog()]);
  const match    = findUntrackedCatalogEntry(url, services, catalog);
  const degraded = countDegraded(states);

  if (match) {
    browser.action.setBadgeText({ text: '+', tabId });
    browser.action.setBadgeBackgroundColor({ color: '#6366f1', tabId });
  } else {
    browser.action.setBadgeText({ text: degraded > 0 ? String(degraded) : '', tabId });
    if (degraded > 0) browser.action.setBadgeBackgroundColor({ color: '#dc2626', tabId });
  }
}

async function refreshBadge(states) {
  const degraded = countDegraded(states);

  // Icon color reflects worst status across all tracked services
  updateActionIcon(states);

  // Global badge (applies to all tabs that don't have a tab-specific override)
  await browser.action.setBadgeText({ text: degraded > 0 ? String(degraded) : '' });
  if (degraded > 0) await browser.action.setBadgeBackgroundColor({ color: '#dc2626' });

  // Refresh the active tab in case it's showing "+" and the tracking state changed
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (tab?.url) updateTabBadge(tab.id, tab.url);
  } catch { /* no active window */ }
}

// ─── Notifications ───────────────────────────────────────────────────────────

function notify(service, prevIndicator, newIndicator, description) {
  if (!service.notificationsEnabled) return;

  const wasOk = !prevIndicator || prevIndicator === 'none';
  const isOk  = newIndicator === 'none';

  // ok → ok: nothing to say
  if (wasOk && isOk) return;

  let title;
  if (wasOk && !isOk) {
    title = `${service.name} — Issue detected`;
  } else if (!wasOk && isOk) {
    title = `${service.name} — Recovered`;
  } else {
    title = `${service.name} — Status update`;
  }

  browser.notifications.create(`sp_${service.id}_${Date.now()}`, {
    type:     'basic',
    iconUrl:  'common/icons/icon128.png',
    title,
    message:  description ?? '',
    priority: isOk ? 0 : 2,
  });
}

// ─── Core poll ───────────────────────────────────────────────────────────────

async function pollService(serviceId) {
  const { services, states } = await load();
  const service = services.find(s => s.id === serviceId);
  if (!service) return;

  const prev = states[serviceId] ?? null;

  const COMP_STATUS_LABELS = {
    operational:          'Operational',
    degraded_performance: 'Degraded',
    partial_outage:       'Partial outage',
    major_outage:         'Major outage',
    under_maintenance:    'Maintenance',
  };

  let freshData;
  try {
    freshData = await fetchFromCache(service);

    // If tracking a specific component, narrow the result to that component.
    if (service.componentId) {
      const comp = freshData.components.find(c => c.id === service.componentId);
      if (comp) {
        freshData.indicator   = componentStatusToIndicator(comp.status) ?? freshData.indicator;
        freshData.description = COMP_STATUS_LABELS[comp.status] ?? comp.status ?? '';
        freshData.components  = [comp];
      }
    }
  } catch (err) {
    // Keep last known state but record the error; use normal interval
    freshData = {
      indicator:       prev?.indicator       ?? 'none',
      description:     prev?.description     ?? 'Unknown',
      components:      prev?.components      ?? [],
      activeIncidents: prev?.activeIncidents ?? [],
      lastFetched:     Date.now(),
      error:           err.message,
    };
  }

  // Schedule the next poll from the file's own generatedAt + ttl + buffer.
  // ttl reflects the actual GH Actions schedule frequency (currently ~1 hour).
  // If the expected next generation is already past (workflow delayed), retry
  // every 10 s until a file with a newer generatedAt appears.
  let nextPollAt;
  if (freshData.generatedAt && freshData.ttl && !freshData.error) {
    const nextGen = new Date(freshData.generatedAt).getTime()
      + freshData.ttl * 1000
      + POLL_GEN_BUFFER_MS;
    nextPollAt = nextGen > Date.now() ? nextGen : Date.now() + POLL_FAST_MS;
  } else {
    nextPollAt = Date.now() + POLL_FALLBACK_MS;
  }

  const newState = {
    ...(prev ?? {}),
    ...freshData,
    prevIndicator: prev?.indicator ?? null,
    nextFetchAt:   nextPollAt,
  };

  const newStates = { ...states, [serviceId]: newState };
  await save({ states: newStates });
  await refreshBadge(newStates);

  if (prev && prev.indicator !== freshData.indicator && !freshData.error) {
    notify(service, prev.indicator, freshData.indicator, freshData.description);
  }

  browser.alarms.create(`poll_${serviceId}`, { when: nextPollAt });
}

// ─── Startup helpers ─────────────────────────────────────────────────────────

// Sync tracked catalog services against the current catalog definitions.
// Only pageUrl is kept in sync (the display link may change); fetching is done
// via GitHub Pages so API-internal fields (type, apiBase, pageId) are irrelevant.
// User-controlled fields (name, notificationsEnabled) are left untouched.
const CATALOG_SYNC_FIELDS = ['pageUrl'];

async function syncCatalog() {
  const [{ services }, catalog] = await Promise.all([load(), getCatalog()]);
  const updated = services.map(service => {
    const canonical = catalog.find(c => c.id === service.id);
    if (!canonical) return service;
    const patch = {};
    for (const field of CATALOG_SYNC_FIELDS) {
      if (canonical[field] !== undefined && canonical[field] !== service[field]) {
        patch[field] = canonical[field];
      }
    }
    return Object.keys(patch).length ? { ...service, ...patch } : service;
  });
  await save({ services: updated });
}

async function startAll() {
  await syncCatalog();
  const { services } = await load();
  for (const service of services) {
    pollService(service.id);
  }
}

// Restart any service whose next poll was overdue by more than 2 minutes
async function watchdog() {
  const { services, states } = await load();
  const now = Date.now();
  for (const service of services) {
    const st = states[service.id];
    if (!st || !st.nextFetchAt || now > st.nextFetchAt + 120_000) {
      pollService(service.id);
    }
  }
}

// ─── Event listeners ─────────────────────────────────────────────────────────

browser.runtime.onInstalled.addListener(() => {
  browser.alarms.create('watchdog', { periodInMinutes: 5 });
  startAll();
});

browser.runtime.onStartup.addListener(() => {
  browser.alarms.create('watchdog', { periodInMinutes: 5 });
  startAll();
});

browser.alarms.onAlarm.addListener(alarm => {
  if (alarm.name.startsWith('poll_')) {
    pollService(alarm.name.slice(5));
  } else if (alarm.name === 'watchdog') {
    watchdog();
  }
});

browser.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await browser.tabs.get(tabId);
    if (tab.url) updateTabBadge(tab.id, tab.url);
  } catch { /* tab may have closed */ }
});

browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    updateTabBadge(tabId, tab.url);
  }
});

browser.runtime.onMessage.addListener((msg, _sender, respond) => {
  switch (msg.type) {
    case 'getState':
      load().then(respond);
      return true;

    case 'addService':
      addService(msg.service)
        .then(() => respond({ ok: true }))
        .catch(e => respond({ error: e.message }));
      return true;

    case 'removeService':
      removeService(msg.id)
        .then(() => respond({ ok: true }))
        .catch(e => respond({ error: e.message }));
      return true;

    case 'setNotifications':
      setNotifications(msg.id, msg.enabled)
        .then(() => respond({ ok: true }));
      return true;

    // Popup asks: does the current tab match an untracked catalog entry?
    case 'getTabCatalogMatch':
      Promise.all([load(), getCatalog()]).then(([{ services }, catalog]) => {
        respond({ match: findUntrackedCatalogEntry(msg.url, services, catalog) ?? null });
      });
      return true;
  }
});
