#!/usr/bin/env node
// build.js — assembles production-ready extension bundles.
//
// Usage:
//   node build.js <version>          # e.g. node build.js 1.2.0
//
// Outputs:
//   dist/chromium/   — Chromium extension (manifest v3, chrome.* via shim)
//   dist/firefox/    — Firefox extension  (manifest v3, browser.* native)
//
// Each output directory is a self-contained extension that can be:
//   - loaded as an unpacked extension for testing
//   - zipped and submitted to the relevant store

'use strict';

const fs   = require('fs');
const path = require('path');

// ─── Args ─────────────────────────────────────────────────────────────────────

const args    = process.argv.slice(2);
const debug   = args.includes('--debug');
const version = args.find(a => !a.startsWith('--'));
if (!version) {
  console.error('Error: version argument is required.');
  console.error('Usage: node build.js <version> [--debug]  (e.g. 1.2.0)');
  process.exit(1);
}
if (!/^\d+\.\d+\.\d+(\.\d+)?$/.test(version)) {
  console.error(`Error: invalid version "${version}" — expected x.y.z or x.y.z.w`);
  process.exit(1);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Recursively copy src → dest, dereferencing any symlinks along the way.
// Files whose name appears in `exclude` are skipped at every level.
function copyDir(src, dest, exclude = new Set()) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (exclude.has(entry.name)) continue;
    const srcPath  = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    const real     = entry.isSymbolicLink() ? fs.realpathSync(srcPath) : srcPath;
    if (fs.statSync(real).isDirectory()) {
      copyDir(real, destPath, exclude);
    } else {
      fs.copyFileSync(real, destPath);
    }
  }
}

// ─── Build ────────────────────────────────────────────────────────────────────

const ROOT    = __dirname;
const OUT_DIR = path.join(ROOT, 'dist');
const EXCLUDE = new Set(['config.dist.js']);

// Start clean.
fs.rmSync(OUT_DIR, { recursive: true, force: true });

for (const browser of ['chromium', 'firefox']) {
  const outDir = path.join(OUT_DIR, browser);

  // Copy the full browser directory, dereferencing the common/ symlink.
  // config.dist.js is a source-only template — the compiled config.js replaces it.
  copyDir(path.join(ROOT, browser), outDir, EXCLUDE);

  // Write config.js from the shared template (gitignored in source, required at runtime).
  // In debug builds, override DEBUG to true.
  let config = fs.readFileSync(path.join(ROOT, 'common', 'config.dist.js'), 'utf8');
  if (debug) config = config.replace('const DEBUG = false;', 'const DEBUG = true;');
  fs.writeFileSync(path.join(outDir, 'config.js'), config);

  // Patch manifest: inject version, strip the dev-only localhost permission.
  const manifestPath = path.join(outDir, 'manifest.json');
  const manifest     = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.version   = version;
  manifest.host_permissions = (manifest.host_permissions ?? [])
    .filter(p => !p.includes('localhost'));
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

  console.log(`dist/${browser}/  v${version}  ✓`);
}
