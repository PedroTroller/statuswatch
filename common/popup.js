// popup.js — UI logic for the Status Pages extension popup

let state = { services: [], states: {} };
let expandedIds = new Set();
let addPanelOpen = false;
let tabMatchId = null;          // catalog id matched from current tab URL, if any
let catalogEnriched = null;     // enriched catalog from GitHub Pages (with status + components)
let catalogGeneratedAt = null;  // ISO timestamp from the last catalog.json fetch
let catalogTtl = null;          // ttl seconds from the last catalog.json fetch
let catalogExpandedIds = new Set(); // catalog items with component list open

// ─── Logo helpers ─────────────────────────────────────────────────────────────

// Derive the primary product domain from a service entry.
// Used as the query for Google's favicon service.
function primaryDomain(service) {
  const raw = service.relatedDomains?.[0] ?? new URL(service.statusPageUrl).host;
  return raw.replace(/^\*\./, '');
}

// Returns an <img> tag for the service logo.
// Prefers the pre-cached icon from the enriched catalog; falls back to Google's
// favicon service. The lettered-badge fallback fires on image load error.
function logoImg(service, size = 16) {
  // For component-tracking services ("parentId__componentId"), look up the parent.
  const catalogId = service.id?.split('__')[0];
  const iconUrl   = service.iconUrl
    ?? catalogEnriched?.find(c => c.id === catalogId)?.iconUrl;

  const src = iconUrl
    ? `${GITHUB_PAGES_BASE}/${iconUrl}`
    : `https://www.google.com/s2/favicons?domain=${encodeURIComponent(primaryDomain(service))}&sz=${size * 2}`;

  const init = esc(service.name[0].toUpperCase());
  return `<img class="svc-logo" src="${esc(src)}" width="${size}" height="${size}"
    data-initial="${init}" alt="${init}" draggable="false" />`;
}

// ─── Init ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  const [data, tabInfo, catalogResult] = await Promise.all([
    browser.runtime.sendMessage({ type: 'getState' }),
    getTabCatalogMatch(),
    fetchEnrichedCatalog(),
  ]);
  state.services     = data.services ?? [];
  state.states       = data.states   ?? {};
  tabMatchId         = tabInfo?.match?.id ?? null;
  catalogEnriched    = catalogResult?.services    ?? null;
  catalogGeneratedAt = catalogResult?.generatedAt ?? null;
  catalogTtl         = catalogResult?.ttl         ?? null;

  renderServiceList();   // also calls syncWrapperHeight
  renderTabSuggestion();
  renderStalenessBanner();

  document.getElementById('add-btn').addEventListener('click', toggleAddPanel);
  document.getElementById('catalog-search').addEventListener('input', renderCatalogItems);
  document.getElementById('tab-suggestion').addEventListener('click', onSuggestionClick);

  // Event delegation for service list interactions
  document.getElementById('service-list').addEventListener('click', onServiceListClick);
  document.getElementById('service-list').addEventListener('change', onServiceListChange);

  // CSP-safe logo fallback: replace broken <img> with a lettered badge
  document.addEventListener('error', e => {
    if (e.target.tagName === 'IMG' && e.target.classList.contains('svc-logo')) {
      const size    = e.target.width || 16;
      const initial = e.target.dataset.initial || '?';
      const span    = document.createElement('span');
      span.className   = 'svc-logo-fallback';
      span.textContent = initial;
      span.style.width  = `${size}px`;
      span.style.height = `${size}px`;
      e.target.replaceWith(span);
    }
  }, true);

  // Live update when background mutates storage
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.services) state.services = changes.services.newValue ?? [];
    if (changes.states)   state.states   = changes.states.newValue   ?? {};
    renderServiceList();
    renderTabSuggestion();
    renderStalenessBanner();
    if (addPanelOpen) renderCatalogItems();
  });
});

// ─── Service list rendering ───────────────────────────────────────────────────

function renderServiceList() {
  const el = document.getElementById('service-list');

  if (!state.services.length) {
    el.innerHTML = `
      <div class="empty-state">
        <p>No services tracked yet.</p>
        <button class="btn-primary" id="empty-add-btn">Add your first service</button>
      </div>`;
    document.getElementById('empty-add-btn').addEventListener('click', () => {
      addPanelOpen = true;
      showAddPanel();
    });
    return;
  }

  const trackedCompIds = new Set(
    state.services.filter(s => s.componentId).map(s => s.componentId)
  );

  const sorted = state.services.slice().sort((a, b) => a.name.localeCompare(b.name));

  const hasIssue = s => {
    const st = state.states[s.id];
    return st && (st.error || st.status !== 'operational');
  };

  const issues = sorted
    .filter(hasIssue)
    .sort((a, b) => {
      const ra = COMPONENT_SEVERITY_RANK[state.states[a.id]?.status] ?? 5;
      const rb = COMPONENT_SEVERITY_RANK[state.states[b.id]?.status] ?? 5;
      return ra !== rb ? ra - rb : a.name.localeCompare(b.name);
    });
  const rest = sorted.filter(s => !hasIssue(s));

  let html = '';
  if (issues.length) {
    html += `<div class="section-label section-label--issues">Issues (${issues.length})</div>`;
    html += issues.map(s => renderCard(s, state.states[s.id], trackedCompIds)).join('');
    if (rest.length) {
      html += `<div class="section-label">Operational</div>`;
    }
  }
  html += rest.map(s => renderCard(s, state.states[s.id], trackedCompIds)).join('');

  el.innerHTML = html;
  syncWrapperHeight();
}

function renderCard(service, st, trackedCompIds = new Set()) {
  const expanded  = expandedIds.has(service.id);
  const fetchCls  = st ? (st.error ? ' fetch-error' : ' fetch-ok') : '';
  const dotCls    = serviceStatusDot(st?.status, st?.components);
  const desc     = st ? truncate(st.description, 32) : 'Fetching…';

  const incidentsHtml = (st?.activeIncidents ?? [])
    .map(i => `
      <div class="incident-badge">
        ⚠ <a href="${esc(i.url)}" target="_blank">${esc(i.name)}</a>
      </div>`)
    .join('');

  const showTrackBtn = !service.componentId;
  const componentsHtml = sortComponents(st?.components ?? [])
    .map(c => {
      const alreadyTracked = trackedCompIds.has(c.id);
      const trackBtn = showTrackBtn ? `
        <button class="btn-track-comp${alreadyTracked ? ' tracked' : ''}"
          data-action="track-comp"
          data-service-id="${esc(service.id)}"
          data-comp-id="${esc(c.id)}"
          data-comp-name="${esc(c.name)}"
          title="${alreadyTracked ? 'Already tracked' : 'Track this component separately'}"
          ${alreadyTracked ? 'disabled' : ''}>+</button>` : '';
      return `
        <div class="component-row">
          <span class="comp-dot ${c.status ?? 'unknown'}"></span>
          <span class="comp-name">${esc(c.name)}</span>
          <span class="comp-status">${compLabel(c.status)}</span>
          ${trackBtn}
        </div>`;
    })
    .join('');

  const errorHtml = st?.error
    ? `<div class="service-error">Could not fetch: ${esc(st.error)}</div>`
    : '';

  const updated = st?.lastFetched ? `Updated ${timeAgo(st.lastFetched)}` : '';
  const bellCls  = service.notificationsEnabled ? '' : 'muted';
  const threshold = service.notificationThreshold ?? 'degraded_performance';

  return `
    <div class="service-card${expanded ? ' expanded' : ''}${fetchCls}" data-id="${esc(service.id)}">
      <div class="service-header">
        ${logoImg(service, 16)}
        ${statusIconSvg(dotCls)}
        <span class="service-name">${esc(service.name)}</span>
        ${service.beta ? '<span class="badge-beta">beta</span>' : ''}
        <span class="service-desc">${desc}</span>
        <span class="chevron">▶</span>
      </div>
      <div class="service-body">
        ${errorHtml}
        ${incidentsHtml ? `<div class="incidents">${incidentsHtml}</div>` : ''}
        <div class="components">${componentsHtml}</div>
        <div class="service-footer">
          <span class="service-footer-meta">${updated}</span>
          <a class="btn-open" href="${esc(service.statusPageUrl)}" target="_blank">Open ↗</a>
          <button class="btn-sm ${bellCls}" data-action="notif" data-id="${esc(service.id)}"
            title="${service.notificationsEnabled ? 'Mute notifications' : 'Enable notifications'}">🔔</button>
          ${service.notificationsEnabled ? `
          <select class="threshold-select" data-action="threshold" data-id="${esc(service.id)}"
            title="Notify when severity reaches…">
            <option value="under_maintenance"    ${threshold === 'under_maintenance'    ? 'selected' : ''}>≥ maint</option>
            <option value="degraded_performance" ${threshold === 'degraded_performance' ? 'selected' : ''}>≥ minor</option>
            <option value="partial_outage"       ${threshold === 'partial_outage'       ? 'selected' : ''}>≥ major</option>
            <option value="major_outage"         ${threshold === 'major_outage'         ? 'selected' : ''}>≥ crit</option>
          </select>` : ''}
          <button class="btn-sm btn-remove" data-action="remove" data-id="${esc(service.id)}"
            title="Remove">✕</button>
        </div>
      </div>
    </div>`;
}

// ─── Service list click delegation ───────────────────────────────────────────

function onServiceListClick(e) {
  // Track individual component
  const trackCompBtn = e.target.closest('[data-action="track-comp"]');
  if (trackCompBtn) {
    e.stopPropagation();
    const { serviceId, compId, compName } = trackCompBtn.dataset;
    const parent = state.services.find(s => s.id === serviceId);
    if (!parent) return;
    browser.runtime.sendMessage({
      type: 'addService',
      service: {
        id:                   `${parent.id}__${compId}`,
        name:                 `${parent.name} — ${compName}`,
        type:                 parent.type,
        statusPageUrl:        parent.statusPageUrl,
        componentId:          compId,
        notificationsEnabled: true,
      },
    });
    return;
  }

  // Notification toggle
  const notifBtn = e.target.closest('[data-action="notif"]');
  if (notifBtn) {
    e.stopPropagation();
    const id = notifBtn.dataset.id;
    const service = state.services.find(s => s.id === id);
    if (service) {
      browser.runtime.sendMessage({
        type: 'setNotifications',
        id,
        enabled: !service.notificationsEnabled,
      });
    }
    return;
  }

  // Remove
  const removeBtn = e.target.closest('[data-action="remove"]');
  if (removeBtn) {
    e.stopPropagation();
    browser.runtime.sendMessage({ type: 'removeService', id: removeBtn.dataset.id });
    return;
  }

  // External link — open in new tab
  const link = e.target.closest('a[target="_blank"]');
  if (link) {
    e.preventDefault();
    browser.tabs.create({ url: link.href });
    return;
  }

  // Expand / collapse card
  const header = e.target.closest('.service-header');
  if (header) {
    const card = header.closest('.service-card');
    const id   = card?.dataset.id;
    if (!id) return;
    if (expandedIds.has(id)) expandedIds.delete(id);
    else expandedIds.add(id);
    renderServiceList();
  }
}

function onServiceListChange(e) {
  const thresholdSelect = e.target.closest('[data-action="threshold"]');
  if (!thresholdSelect) return;
  browser.runtime.sendMessage({
    type:      'setThreshold',
    id:        thresholdSelect.dataset.id,
    threshold: thresholdSelect.value,
  });
}

// ─── View height sync ─────────────────────────────────────────────────────────
// Both panes are always in the DOM. Pin the wrapper to the active pane's height
// so the off-screen pane doesn't stretch the popup.

function syncWrapperHeight() {
  const wrapper = document.querySelector('.views-wrapper');
  const panes   = document.querySelectorAll('.view-pane');
  const pane    = panes[addPanelOpen ? 1 : 0];
  if (pane) wrapper.style.height = pane.scrollHeight + 'px';
}

// ─── Tab suggestion ───────────────────────────────────────────────────────────

function renderTabSuggestion() {
  const el = document.getElementById('tab-suggestion');
  const catalog = catalogEnriched ?? [];
  const entry = tabMatchId ? catalog.find(c => c.id === tabMatchId) : null;

  // Hide if no match, already tracked, or catalog view is open
  if (addPanelOpen || !entry || state.services.find(s => s.id === tabMatchId)) {
    el.classList.add('hidden');
    el.innerHTML = '';
    syncWrapperHeight();
    return;
  }

  el.innerHTML = `
    ${logoImg(entry, 28)}
    <div class="tab-suggestion-info">
      <div class="tab-suggestion-name">
        ${esc(entry.name)}${entry.beta ? ' <span class="badge-beta">beta</span>' : ''}
      </div>
      <div class="tab-suggestion-sub">Not currently tracked</div>
    </div>
    <button class="btn-catalog-add" data-catalog-id="${esc(entry.id)}">+ Track</button>`;
  el.classList.remove('hidden');
  syncWrapperHeight();
}

function onSuggestionClick(e) {
  const btn = e.target.closest('.btn-catalog-add');
  if (!btn) return;
  const entry = (catalogEnriched ?? []).find(c => c.id === btn.dataset.catalogId);
  if (!entry) return;
  btn.disabled    = true;
  btn.textContent = 'Adding…';
  browser.runtime.sendMessage({
    type:    'addService',
    service: { ...entry, notificationsEnabled: true },
  });
}

// ─── Add panel ────────────────────────────────────────────────────────────────

function toggleAddPanel() {
  if (addPanelOpen) hideAddPanel();
  else showAddPanel();
}

const SVG_BACK_ICON = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none">
  <path d="M9 2L4 7L9 12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

const SVG_ADD_ICON = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none">
  <path d="M7 1v12M1 7h12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
</svg>`;

function showAddPanel() {
  addPanelOpen = true;
  renderTabSuggestion(); // hides suggestion since addPanelOpen is now true
  renderCatalogItems();
  document.getElementById('views-track').classList.add('show-catalog');
  document.querySelector('.popup-footer').classList.add('hidden');
  const btn = document.getElementById('add-btn');
  btn.innerHTML = SVG_BACK_ICON;
  btn.title = 'Back to tracked services';
  // Focus after the slide completes
  setTimeout(() => document.getElementById('catalog-search').focus(), 260);
}

function hideAddPanel() {
  addPanelOpen = false;
  document.getElementById('views-track').classList.remove('show-catalog');
  document.querySelector('.popup-footer').classList.remove('hidden');
  renderTabSuggestion(); // re-shows suggestion if applicable
  const btn = document.getElementById('add-btn');
  btn.innerHTML = SVG_ADD_ICON;
  btn.title = 'Add service';
  document.getElementById('catalog-search').value = '';
  // Resize after the slide-back transition finishes
  setTimeout(syncWrapperHeight, 260);
}

// ─── Catalog items ────────────────────────────────────────────────────────────

function renderCatalogItems() {
  const container = document.getElementById('catalog-items');

  if (!catalogEnriched) {
    container.innerHTML = `<div class="catalog-empty">Loading catalog…</div>`;
    syncWrapperHeight();
    return;
  }

  const query    = document.getElementById('catalog-search').value.toLowerCase().trim();
  const catalog  = catalogEnriched;
  const addedIds = new Set(state.services.map(s => s.id));
  const trackedCompIds = new Set(
    state.services.filter(s => s.componentId).map(s => s.componentId)
  );

  const filtered = catalog
    .filter(c =>
      !query ||
      c.name.toLowerCase().includes(query) ||
      c.statusPageUrl.includes(query) ||
      (c.searchAliases ?? []).some(a => a.includes(query))
    )
    .sort((a, b) => a.name.localeCompare(b.name));

  if (!filtered.length) {
    container.innerHTML = `<div class="catalog-empty">No services found</div>`;
    syncWrapperHeight();
    return;
  }

  container.innerHTML = filtered.map(c => {
    const tracked  = addedIds.has(c.id);
    const comps    = sortComponents(c.components ?? []);
    const expanded = catalogExpandedIds.has(c.id);

    const compsToggle = comps.length ? `
      <button class="catalog-comps-toggle" data-toggle-id="${esc(c.id)}">
        <span class="catalog-comps-chevron">${expanded ? '▼' : '▶'}</span>
        ${comps.length} component${comps.length > 1 ? 's' : ''}
      </button>` : '';

    const compRows = comps.map(comp => {
      const alreadyTracked = addedIds.has(`${c.id}__${comp.id}`) || trackedCompIds.has(comp.id);
      return `
        <div class="catalog-comp-row">
          <span class="comp-dot ${comp.status ?? 'unknown'}"></span>
          <span class="comp-name">${esc(comp.name)}</span>
          <span class="comp-status">${compLabel(comp.status)}</span>
          ${alreadyTracked
            ? `<span class="label-tracked" style="font-size:10px;padding:2px 6px">Tracking</span>`
            : `<button class="btn-catalog-track"
                data-catalog-id="${esc(c.id)}"
                data-comp-id="${esc(comp.id)}"
                data-comp-name="${esc(comp.name)}">Track</button>`}
        </div>`;
    }).join('');

    const compList = comps.length ? `
      <div class="catalog-comp-list${expanded ? '' : ' hidden'}" data-comps-id="${esc(c.id)}">
        ${compRows}
      </div>` : '';

    return `
      <div class="catalog-item" data-id="${esc(c.id)}">
        <div class="catalog-item-header">
          ${logoImg(c, 20)}
          ${c.status !== undefined ? statusIconSvg(serviceStatusDot(c.status, c.components)) : ''}
          <div class="catalog-item-info">
            <div class="catalog-item-name">
              ${esc(c.name)}${c.beta ? ' <span class="badge-beta">beta</span>' : ''}
            </div>
            <div class="catalog-item-url">${esc(c.statusPageUrl)}</div>
          </div>
          ${tracked
            ? `<span class="label-tracked">Tracking</span>`
            : `<button class="btn-catalog-add" data-catalog-id="${esc(c.id)}">Add</button>`}
        </div>
        ${compsToggle}
        ${compList}
      </div>`;
  }).join('');

  // Replace listener to avoid duplicates across re-renders
  container.removeEventListener('click', onCatalogClick);
  container.addEventListener('click', onCatalogClick);
  syncWrapperHeight();
}

function onCatalogClick(e) {
  // ── Add whole service ────────────────────────────────────────────────────────
  const addBtn = e.target.closest('.btn-catalog-add');
  if (addBtn) {
    const entry = (catalogEnriched ?? []).find(c => c.id === addBtn.dataset.catalogId);
    if (!entry) return;
    addBtn.disabled = true;
    addBtn.textContent = 'Adding…';
    browser.runtime.sendMessage({ type: 'addService', service: { ...entry, notificationsEnabled: true } });
    return;
  }

  // ── Toggle component list ────────────────────────────────────────────────────
  const toggle = e.target.closest('.catalog-comps-toggle');
  if (toggle) {
    const id   = toggle.dataset.toggleId;
    const open = !catalogExpandedIds.has(id);
    if (open) catalogExpandedIds.add(id); else catalogExpandedIds.delete(id);
    // Patch DOM directly — no full re-render needed
    const list    = document.querySelector(`.catalog-comp-list[data-comps-id="${id}"]`);
    const chevron = toggle.querySelector('.catalog-comps-chevron');
    list?.classList.toggle('hidden', !open);
    if (chevron) chevron.textContent = open ? '▼' : '▶';
    syncWrapperHeight();
    return;
  }

  // ── Track individual component ───────────────────────────────────────────────
  const trackBtn = e.target.closest('.btn-catalog-track');
  if (trackBtn) {
    const { catalogId, compId, compName } = trackBtn.dataset;
    const entry = (catalogEnriched ?? []).find(c => c.id === catalogId);
    if (!entry) return;
    trackBtn.disabled = true;
    trackBtn.textContent = 'Adding…';
    browser.runtime.sendMessage({
      type:    'addService',
      service: {
        id:                   `${catalogId}__${compId}`,
        name:                 `${entry.name} — ${compName}`,
        statusPageUrl:              entry.statusPageUrl,
        componentId:          compId,
        notificationsEnabled: true,
      },
    });
    return;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function statusDot(status) {
  switch (status) {
    case 'operational':          return 'ok';
    case 'under_maintenance':    return 'maintenance';
    case 'degraded_performance': return 'minor';
    case 'partial_outage':       return 'major';
    case 'major_outage':         return 'critical';
    case undefined:
    case null:                   return 'loading';
    default:                     return 'unknown';
  }
}

function serviceStatusDot(status, components) {
  return statusDot(status);
}

// Returns an inline SVG icon matching the toolbar icon shapes from background.js.
// Checkmark coordinates are derived from the same CK constant (scaled to 14 px).
// Falls back to a plain dot span for loading/unknown states.
function statusIconSvg(cls) {
  switch (cls) {
    case 'ok':
      return `<svg class="status-icon ok" width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><circle cx="7" cy="7" r="6.3" fill="#22c55e"/><polyline points="3.1,7.4 5.9,9.9 10.9,4.1" stroke="white" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    case 'maintenance':
      return `<svg class="status-icon maintenance" width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><circle cx="7" cy="7" r="6.3" fill="#94a3b8"/><line x1="2.8" y1="11.5" x2="7.8" y2="6.2" stroke="white" stroke-width="1.9" stroke-linecap="round"/><circle cx="9.5" cy="4.2" r="2.8" stroke="white" stroke-width="1.5" fill="none"/></svg>`;
    case 'minor':
      return `<svg class="status-icon minor" width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><polygon points="7,0.6 13.5,13.4 0.5,13.4" fill="#eab308"/><rect x="5.95" y="4.6" width="2.1" height="4.2" rx="0.6" fill="white"/><circle cx="7" cy="11.2" r="1.2" fill="white"/></svg>`;
    case 'major':
      return `<svg class="status-icon major" width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><polygon points="7,0.6 13.5,13.4 0.5,13.4" fill="#f97316"/><rect x="5.95" y="4.6" width="2.1" height="4.2" rx="0.6" fill="white"/><circle cx="7" cy="11.2" r="1.2" fill="white"/></svg>`;
    case 'critical':
      return `<svg class="status-icon critical" width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><polygon points="7,0.5 8.24,4.0 11.6,2.4 10.0,5.76 13.5,7 10.0,8.24 11.6,11.6 8.24,10.0 7,13.5 5.76,10.0 2.4,11.6 4.0,8.24 0.5,7 4.0,5.76 2.4,2.4 5.76,4.0" fill="#ef4444"/><rect x="6.05" y="3.4" width="1.9" height="4.0" rx="0.6" fill="white"/><circle cx="7" cy="9.7" r="1.1" fill="white"/></svg>`;
    default:
      return `<span class="dot ${cls}"></span>`;
  }
}

const COMP_LABELS = {
  operational:          'Operational',
  degraded_performance: 'Degraded',
  partial_outage:       'Partial outage',
  major_outage:         'Major outage',
  under_maintenance:    'Maintenance',
};
function compLabel(status) {
  return COMP_LABELS[status] ?? (status ?? 'Unknown');
}

// Severity order for component sorting: worst first, operational last.
const COMPONENT_SEVERITY_RANK = {
  major_outage:         0,
  partial_outage:       1,
  degraded_performance: 2,
  under_maintenance:    3,
  operational:          4,
};

function sortComponents(components) {
  return components.slice().sort((a, b) => {
    const rankDiff = (COMPONENT_SEVERITY_RANK[a.status] ?? 5) - (COMPONENT_SEVERITY_RANK[b.status] ?? 5);
    return rankDiff !== 0 ? rankDiff : a.name.localeCompare(b.name);
  });
}

function truncate(str, max) {
  if (!str) return '';
  return str.length > max ? str.slice(0, max - 1) + '…' : str;
}

function timeAgo(ts) {
  if (!ts) return '';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 5)   return 'just now';
  if (s < 60)  return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60)  return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

function esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Ask the background whether the current active tab matches an untracked
// catalog entry. Returns null if the tab URL isn't accessible or doesn't match.
async function getTabCatalogMatch() {
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url?.startsWith('http')) return null;
    return browser.runtime.sendMessage({ type: 'getTabCatalogMatch', url: tab.url });
  } catch {
    return null;
  }
}

// Fetch the enriched catalog (with live indicator + components) from the cache.
// Returns { services, generatedAt, ttl } or null on failure.
async function fetchEnrichedCatalog() {
  try {
    const res = await fetch(`${GITHUB_PAGES_BASE}/catalog.json`, { cache: 'no-cache' });
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data?.services)) return null;
    return { services: data.services, generatedAt: data.generatedAt ?? null, ttl: data.ttl ?? null };
  } catch {
    return null;
  }
}

// Show a warning banner when the cached data is overdue by more than 50% of the
// expected refresh interval (ttl). Falls back to 90 minutes if ttl is unknown.
function renderStalenessBanner() {
  const banner = document.getElementById('staleness-banner');
  if (!banner) return;
  if (!catalogGeneratedAt) {
    banner.classList.add('hidden');
    return;
  }
  const ttlMs           = (catalogTtl ?? 5400) * 1000;
  const staleThresholdMs = ttlMs * 1.5;
  const age = Date.now() - new Date(catalogGeneratedAt).getTime();
  if (age > staleThresholdMs) {
    banner.textContent = `⚠ Status data is ${timeAgo(new Date(catalogGeneratedAt).getTime())} — the update service may be delayed.`;
    banner.classList.remove('hidden');
  } else {
    banner.classList.add('hidden');
  }
}
