#!/usr/bin/env node
// Generates proxy/dist/index.html: the statuswatch status page, grouped by category.
//
// Reads proxy/dist/catalog.json, which node proxy/fetch-all.js has just written and
// which already carries status, components and iconUrl per service. No network.
// Run it after fetch-all.js and before the Pages artifact is uploaded.
//
// Usage: node site/build.js [output.html]

'use strict';

const fs   = require('fs');
const path = require('path');

const { StatusEnum, statusFromValue } = require('../common/value-objects/status.js');

const ROOT     = path.join(__dirname, '..');
const CATALOG  = path.join(ROOT, 'proxy', 'dist', 'catalog.json');
const OUTPUT   = process.argv[2] || path.join(ROOT, 'proxy', 'dist', 'index.html');
const REPO_URL = 'https://github.com/PedroTroller/statuswatch';

// Category display order lives in proxy/catalog.js, next to the closed set the
// validator enforces, so this file does not get a second opinion on it.
const CATEGORIES = new Function(
  `${fs.readFileSync(path.join(ROOT, 'proxy', 'catalog.js'), 'utf8')}; return CATEGORIES;`
)();

const LABEL = {
  operational:          'Operational',
  under_maintenance:    'Under maintenance',
  degraded_performance: 'Degraded',
  partial_outage:       'Partial outage',
  major_outage:         'Major outage',
};

const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const level = (value) => statusFromValue(value)?.level ?? StatusEnum.DEGRADED_PERFORMANCE.level;

function worst(services) {
  return services.reduce(
    (acc, s) => (level(s.status) > level(acc) ? s.status : acc),
    StatusEnum.OPERATIONAL.value,
  );
}

// A service is worth expanding only when something is wrong with it: the healthy
// ones would otherwise contribute thousands of rows saying "operational".
function troubledComponents(service) {
  return (service.components ?? []).filter(c => c.status !== StatusEnum.OPERATIONAL.value);
}

function activeIncidents(service) {
  const seen = new Map();
  for (const component of service.components ?? []) {
    for (const incident of component.activeIncidents ?? []) {
      if (incident?.name) seen.set(incident.id ?? incident.name, incident);
    }
  }
  return [...seen.values()];
}

function serviceRow(service) {
  const troubled  = troubledComponents(service);
  const incidents = activeIncidents(service);
  const status    = service.status ?? 'unknown';

  const detail = [
    ...incidents.map(i => i.url
      ? `<a href="${esc(i.url)}">${esc(i.name)}</a>`
      : esc(i.name)),
    ...troubled.map(c => `${esc(c.name)} <span class="muted">${esc(LABEL[c.status] ?? c.status)}</span>`),
  ];

  return [
    `<li class="svc ${esc(status)}">`,
    `  <img src="${esc(service.iconUrl ?? '')}" alt="" width="20" height="20" loading="lazy">`,
    `  <a class="name" href="${esc(service.statusPageUrl)}">${esc(service.name)}</a>`,
    `  <span class="pill">${esc(LABEL[status] ?? status)}</span>`,
    detail.length ? `  <ul class="detail">${detail.map(d => `<li>${d}</li>`).join('')}</ul>` : '',
    `</li>`,
  ].filter(Boolean).join('\n');
}

function build(catalog) {
  const services = [...catalog.services].sort((a, b) => a.name.localeCompare(b.name));
  const overall  = worst(services);
  const down     = services.filter(s => s.status !== StatusEnum.OPERATIONAL.value);

  const byCategory = new Map(CATEGORIES.map(c => [c, []]));
  for (const service of services) {
    // A category absent from CATEGORIES cannot reach here: the catalog validator
    // rejects it. Falling back keeps the page buildable if that ever changes.
    if (!byCategory.has(service.category)) byCategory.set(service.category ?? 'Other', []);
    byCategory.get(service.category ?? 'Other').push(service);
  }

  const sections = [...byCategory.entries()]
    .filter(([, list]) => list.length > 0)
    .map(([category, list]) => `
      <section>
        <h2>${esc(category)} <span class="count">${list.length}</span></h2>
        <ul class="grid">
${list.map(serviceRow).join('\n')}
        </ul>
      </section>`)
    .join('\n');

  const banner = down.length === 0
    ? `<p class="banner operational">All ${services.length} services operational</p>`
    : `<p class="banner ${esc(overall)}">${services.length - down.length} of ${services.length} services operational</p>
       <ul class="down">${down.map(s =>
         `<li><a href="${esc(s.statusPageUrl)}">${esc(s.name)}</a> <span class="pill">${esc(LABEL[s.status] ?? s.status)}</span></li>`
       ).join('')}</ul>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>statuswatch</title>
<meta name="description" content="Live status of ${services.length} developer services, refreshed every 5 minutes.">
<link rel="icon" href="icons/github.png">
<style>
:root {
  --bg: #fff; --fg: #1b1f24; --muted: #6a737d; --line: #e5e7eb; --card: #fff;
  --ok: #1a7f37; --warn: #9a6700; --bad: #cf222e;
}
@media (prefers-color-scheme: dark) {
  :root { --bg: #0d1117; --fg: #e6edf3; --muted: #8b949e; --line: #21262d; --card: #161b22;
          --ok: #3fb950; --warn: #d29922; --bad: #f85149; }
}
* { box-sizing: border-box; }
body { margin: 0; padding: 2rem 1rem 4rem; background: var(--bg); color: var(--fg);
       font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; }
main { max-width: 1100px; margin: 0 auto; }
h1 { font-size: 1.6rem; margin: 0 0 .25rem; }
h2 { font-size: 1rem; margin: 2rem 0 .75rem; padding-bottom: .4rem; border-bottom: 1px solid var(--line); }
.count { color: var(--muted); font-weight: 400; }
.sub { color: var(--muted); margin: 0 0 1.5rem; }
.sub a { color: inherit; }
.banner { font-size: 1.05rem; font-weight: 600; padding: .8rem 1rem; border-radius: 6px;
          border: 1px solid var(--line); background: var(--card); margin: 0 0 1rem; }
.banner.operational { color: var(--ok); }
.banner.under_maintenance, .banner.degraded_performance { color: var(--warn); }
.banner.partial_outage, .banner.major_outage { color: var(--bad); }
.down { list-style: none; margin: 0 0 1rem; padding: 0; display: flex; flex-wrap: wrap; gap: .5rem; }
.down li { border: 1px solid var(--line); border-radius: 6px; padding: .35rem .6rem; background: var(--card); }
.grid { list-style: none; margin: 0; padding: 0;
        display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: .4rem; }
.svc { display: grid; grid-template-columns: 20px 1fr auto; align-items: center; gap: .55rem;
       padding: .5rem .65rem; border: 1px solid var(--line); border-radius: 6px; background: var(--card); }
.svc img { border-radius: 4px; }
.name { color: inherit; text-decoration: none; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.name:hover { text-decoration: underline; }
.pill { font-size: .75rem; color: var(--ok); white-space: nowrap; }
.svc.under_maintenance .pill, .svc.degraded_performance .pill { color: var(--warn); }
.svc.partial_outage .pill, .svc.major_outage .pill { color: var(--bad); }
.detail { grid-column: 1 / -1; list-style: none; margin: .4rem 0 0; padding: .4rem 0 0;
          border-top: 1px dashed var(--line); font-size: .8rem; }
.detail a { color: inherit; }
.muted { color: var(--muted); }
footer { margin-top: 3rem; padding-top: 1rem; border-top: 1px solid var(--line);
         color: var(--muted); font-size: .85rem; }
footer a { color: inherit; }
</style>
</head>
<body>
<main>
  <h1>statuswatch</h1>
  <p class="sub">Status of ${services.length} developer services, collected from their own status pages.
     <a href="${REPO_URL}">Source</a> · <a href="catalog.json">catalog.json</a></p>

  ${banner}

${sections}

  <footer>
    Generated <time datetime="${esc(catalog.generatedAt)}">${esc(catalog.generatedAt)}</time>,
    refreshed every ${Math.round((catalog.ttl ?? 360) / 60)} minutes.
  </footer>
</main>
</body>
</html>
`;
}

if (!fs.existsSync(CATALOG)) {
  console.error(`Error: ${CATALOG} not found — run: node proxy/fetch-all.js`);
  process.exit(1);
}

const catalog = JSON.parse(fs.readFileSync(CATALOG, 'utf8'));
const html    = build(catalog);
fs.writeFileSync(OUTPUT, html);

const down = catalog.services.filter(s => s.status !== StatusEnum.OPERATIONAL.value);
console.log(`Services: ${catalog.services.length} (${down.length} not operational) | ${(html.length / 1024).toFixed(0)} KB`);
console.log(`Generated: ${OUTPUT}`);

module.exports = { build };
