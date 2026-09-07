#!/usr/bin/env node
// Fails when the published catalog has stopped being refreshed.
//
// This exists because HTTP 200 is not evidence of anything here: during the four
// weeks the pipeline was wedged, catalog.json answered 200 the entire time while
// serving data frozen on 6 August. Only `generatedAt` shows the difference.
//
// It has to run outside the publishing workflow. When that workflow is stuck, no
// step inside it executes, so nothing inside it can report the problem.
//
// Usage: node proxy/check-freshness.js [url] [maxAgeMinutes]

'use strict';

const URL_ARG = process.argv[2] || 'https://pedrotroller.github.io/statuswatch/catalog.json';
const MAX_AGE_MINUTES = Number(process.argv[3] || 30);

// The worker dispatches every 5 minutes and the catalog TTL is 6, so 30 minutes
// is six missed cycles: late enough not to fire on a single cancelled run.
async function main() {
  // A query string defeats the CDN cache, which would otherwise hide a stale
  // origin behind a fresh-looking response for up to 10 minutes.
  const res = await fetch(`${URL_ARG}?freshness=${Date.now()}`, {
    signal: AbortSignal.timeout(20_000),
    headers: { 'Cache-Control': 'no-cache' },
  });

  if (!res.ok) throw new Error(`${URL_ARG} returned ${res.status}`);

  const catalog = await res.json();
  if (!catalog?.generatedAt) throw new Error(`${URL_ARG} has no generatedAt`);

  const ageMs      = Date.now() - new Date(catalog.generatedAt).getTime();
  const ageMinutes = Math.round(ageMs / 60_000);

  if (!Number.isFinite(ageMs)) throw new Error(`unparseable generatedAt: ${catalog.generatedAt}`);

  const summary = `generatedAt ${catalog.generatedAt} (${ageMinutes} minutes old), `
                + `${catalog.services?.length ?? 0} services`;

  if (ageMinutes > MAX_AGE_MINUTES) {
    throw new Error(`Published catalog is stale: ${summary}, limit ${MAX_AGE_MINUTES} minutes`);
  }

  console.log(`Fresh: ${summary}`);
}

// `err.stack` omits `cause`, which is where a failed fetch keeps the real reason.
// Without it an unreachable URL reports only "fetch failed".
function describe(err, depth = 0) {
  const head = err?.message ?? String(err);
  return (depth >= 4 || !err?.cause) ? head : `${head}: ${describe(err.cause, depth + 1)}`;
}

main().catch(err => {
  console.error(describe(err));
  process.exit(1);
});
