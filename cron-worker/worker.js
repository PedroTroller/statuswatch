// Cloudflare Worker — triggers the GitHub Actions fetch-status workflow
// every 5 minutes via workflow_dispatch, providing reliable scheduling
// independent of GitHub's own cron throttling.
//
// Required secret (set via `npx wrangler secret put GITHUB_PAT`):
//   GITHUB_PAT  — GitHub Personal Access Token with actions:write scope

export default {
  async scheduled(_event, env) {
    console.log('Triggering fetch-status workflow…');

    const res = await fetch(
      'https://api.github.com/repos/PedroTroller/statuswatch/actions/workflows/fetch-status.yaml/dispatches',
      {
        method: 'POST',
        headers: {
          Authorization:  `Bearer ${env.GITHUB_PAT}`,
          Accept:         'application/vnd.github+json',
          'Content-Type': 'application/json',
          'User-Agent':   'statuswatch-cron',
        },
        body: JSON.stringify({ ref: 'main' }),
      }
    );

    if (!res.ok) {
      const body = await res.text();
      console.error(`GitHub API returned ${res.status}: ${body}`);
      throw new Error(`GitHub API returned ${res.status}: ${body}`);
    }

    console.log('Workflow dispatched successfully.');
  },
};
