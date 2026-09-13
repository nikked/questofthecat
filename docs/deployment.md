# Deployment

[Back to README](../README.md)

`.github/workflows/deploy.yml` tests and builds with the base path
`/questofthecat/` on every pull request, and additionally publishes `dist` to
GitHub Pages at https://nikked.github.io/questofthecat/ on every push to
`main`. Running the workflow by hand from the Actions tab deploys whichever
branch it is started from. Pages must be set to deploy from GitHub Actions in
the repository settings.

## Leaderboard

Scores live in a Google Sheet behind an Apps Script web app. Without the URL
the game still runs; the leaderboard just says it is not configured.

1. Create a Google Sheet and open Extensions > Apps Script.
2. Replace the editor's contents with `apps-script/Code.gs` and save.
3. Deploy > New deployment > Web app, executing as you, with access for
   Anyone. Copy the web app URL.
4. Set it as the repository variable `VITE_SCORES_URL` (Settings > Secrets
   and variables > Actions > Variables), then push or rerun the workflow.

After changing `apps-script/Code.gs`, copy it into the editor and update the
existing deployment through Deploy > Manage deployments > Edit > New version.
Keep Execute as set to Me and Who has access set to Anyone. Open the `/exec`
URL in a signed-out browser to check that it returns JSON rather than an access
error; saving the script alone does not update the deployed version.

The script creates a `scores` tab on first use. Anyone who can reach the URL
can post a row, so the sheet is only as honest as its players; the script
checks shapes, not fairness. For local runs, `VITE_SCORES_URL=... pnpm dev`.

New high-score submission timestamps are stored as ISO 8601 UTC strings (`Z`)
in the sheet. The leaderboard loads when the page opens and reloads after a
successful score submission.
