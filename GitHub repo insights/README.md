# GitHub Repo Insights

A Tampermonkey userscript that adds a sidebar panel to GitHub repo pages showing stats GitHub doesn't surface natively.

## Features

- **Lines of code** — estimated from the repo's file tree (text files only)
- **Repo age** — time since creation
- **Commit activity** — 26-week sparkline plus commits in the last 4 weeks
- **Bus factor** — how many contributors account for 80% of commits
- **Dependency files** — detected manifest files (`package.json`, `requirements.txt`, `Cargo.toml`, etc.)
- **Status chips** — archived, fork, solo maintainer, inactive-with-open-issues
- **Stale-while-revalidate cache** — cached data renders instantly, fresh data loads silently in background
- **SPA-aware** — detects GitHub's client-side navigation and re-renders on repo change

## Installation

1. Install the [Tampermonkey](https://www.tampermonkey.net/) browser extension
2. Open Tampermonkey dashboard → **Create a new script**
3. Paste the contents of `github-repo-insights.js`
4. Save — the script activates automatically on `github.com/<owner>/<repo>` pages

## Usage

1. Visit any repo page on [github.com](https://github.com)
2. Insights panel appears in the sidebar, below the About/stats section
3. (Optional) To raise the GitHub API rate limit from 60 req/hr, generate a [personal access token](https://github.com/settings/tokens) (no scopes needed for public repos) and paste it into the `TOKEN` constant near the top of the script

## Notes

- LOC is an estimate (`total blob bytes / 30`), not an exact line count. Large repos with a truncated file tree show `~` next to the figure.
- `/stats/commit_activity` is precomputed by GitHub and can return `202` on a cold cache — the script skips it rather than retrying, so the sparkline may be briefly unavailable on repos with no recent traffic.

## Author

Devanathan Sabapathy
Claude
