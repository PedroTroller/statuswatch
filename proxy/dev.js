#!/usr/bin/env node
// proxy/dev.js — local dev server for the Status Pages extension.
//
// What it does:
//   1. Patches chromium/config.js and firefox/config.js to point at http://localhost:PORT
//   2. Serves proxy/dist/ on http://localhost:PORT with CORS headers (no-cache)
//   3. Runs proxy/fetch-all.js immediately, then every 5 minutes
//   4. Restores both config.js files on exit (Ctrl+C / SIGTERM)
//
// Usage:
//   node proxy/dev.js           # default port 3001
//   node proxy/dev.js 8080

'use strict';

const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const { spawn } = require('child_process');

const PORT        = parseInt(process.argv[2] ?? '3001', 10);
const DIST_DIR    = path.join(__dirname, 'dist');
const FETCH_ALL   = path.join(__dirname, 'fetch-all.js');

const CONFIG_DIST = path.join(__dirname, '..', 'common', 'config.dist.js');
const CONFIGS     = ['chromium', 'firefox'].map(browser =>
  path.join(__dirname, '..', browser, 'config.js')
);

// ── 1. Write config.js from config.dist.js with the localhost URL ─────────────

const prodConfig = fs.readFileSync(CONFIG_DIST, 'utf8');
const devConfig  = `const GITHUB_PAGES_BASE = 'http://localhost:${PORT}';\n`;

for (const config of CONFIGS) fs.writeFileSync(config, devConfig);
console.log(`[dev] config.js → http://localhost:${PORT}  (will restore on exit)`);

function restoreConfig() {
  for (const config of CONFIGS) {
    try { fs.writeFileSync(config, prodConfig); } catch { /* already exiting */ }
  }
  console.log('[dev] config.js restored to production URL');
}

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { restoreConfig(); process.exit(0); });

// ── 2. HTTP server ────────────────────────────────────────────────────────────

const MIME_TYPES = {
  '.json': 'application/json',
  '.html': 'text/html',
  '.js':   'application/javascript',
  '.css':  'text/css',
};

const server = http.createServer((req, res) => {
  if (req.method !== 'GET') {
    res.writeHead(405, { 'Access-Control-Allow-Origin': '*' });
    res.end();
    return;
  }

  // Strip query string, decode percent-encoding, collapse traversal attempts
  const urlPath  = decodeURIComponent(req.url.split('?')[0]);
  const filePath = path.normalize(path.join(DIST_DIR, urlPath));

  // Refuse paths that escape DIST_DIR
  if (!filePath.startsWith(DIST_DIR + path.sep) && filePath !== DIST_DIR) {
    res.writeHead(403, { 'Access-Control-Allow-Origin': '*' });
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      const status = err.code === 'ENOENT' ? 404 : 500;
      res.writeHead(status, { 'Access-Control-Allow-Origin': '*' });
      res.end(err.code === 'ENOENT' ? 'Not found' : 'Server error');
      return;
    }
    const mime = MIME_TYPES[path.extname(filePath)] ?? 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type':                mime,
      'Access-Control-Allow-Origin': '*',
      'Cache-Control':               'no-cache',
    });
    res.end(data);
    console.log(`[dev] ${req.url}`);
  });
});

server.listen(PORT, () => {
  console.log(`[dev] Serving proxy/dist/ on http://localhost:${PORT}`);
});

// ── 3. Periodic fetch ─────────────────────────────────────────────────────────

function runFetch() {
  const ts = new Date().toISOString();
  console.log(`\n[dev] fetch-all.js starting (${ts})`);

  const child = spawn(process.execPath, [FETCH_ALL], {
    cwd:   path.join(__dirname, '..'),
    stdio: 'inherit',
  });

  child.on('exit', code => {
    if (code !== 0) console.error(`[dev] fetch-all.js exited with code ${code}`);
  });
}

const INTERVAL_MS = 5 * 60 * 1000; // 5 minutes — matches the GitHub Actions cron

runFetch();
setInterval(runFetch, INTERVAL_MS);
