// ==UserScript==
// @name         GitHub Repo Insights
// @namespace    http://tampermonkey.net/
// @version      3.0
// @description  Sidebar insights GitHub doesn't show: LOC, bus factor, activity spark, dep files
// @author       Devanathan Sabapathy, Claude
// @match        https://github.com/*/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      api.github.com
// @license      Apache
// ==/UserScript==
 
(function () {
  'use strict';
 
  const TOKEN       = ''; // github.com/settings/tokens — no scopes needed for public repos
  const CACHE_TTL   = 30 * 60 * 1000; // 30 min
  const STALE_TTL   = 24 * 60 * 60 * 1000; // show stale data up to 24h while revalidating
  const PANEL_ID    = 'ghi-panel';
 
  // ── Route guard ───────────────────────────────────────────
  const SKIP_OWNERS = new Set(['settings','marketplace','explore','topics','trending',
    'notifications','login','join','about','contact','pricing','features']);
 
  function parseRepo() {
    const m = location.pathname.match(/^\/([^/]+)\/([^/]+?)(\/|$)/);
    if (!m || SKIP_OWNERS.has(m[1])) return null;
    return { owner: m[1], repo: m[2] };
  }
 
  // ── API ───────────────────────────────────────────────────
  function apiFetch(path) {
    return new Promise((res, rej) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url: `https://api.github.com${path}`,
        headers: {
          'Accept': 'application/vnd.github.v3+json',
          ...(TOKEN ? { Authorization: `token ${TOKEN}` } : {})
        },
        onload: r => {
          if (r.status === 200) res(JSON.parse(r.responseText));
          else rej(r.status);
        },
        onerror: () => rej(0)
      });
    });
  }
 
  // ── Cache ─────────────────────────────────────────────────
  function cacheGet(key) {
    try {
      const raw = GM_getValue(key);
      if (!raw) return null;
      return JSON.parse(raw); // { data, ts }
    } catch { return null; }
  }
  function cacheSet(key, data) {
    GM_setValue(key, JSON.stringify({ data, ts: Date.now() }));
  }
 
  // ── Data pipeline ─────────────────────────────────────────
  // Strategy: fire all requests in parallel. Stats endpoints
  // (/stats/*) are pre-computed by GitHub and served instantly
  // when warm; on first hit they return 202 — we skip rather
  // than retry to avoid hanging.
 
  const TEXT_EXT = new Set([
    'js','ts','jsx','tsx','mjs','cjs',
    'py','rb','java','c','cpp','cc','h','hpp','cs','go','rs',
    'swift','kt','php','html','htm','css','scss','sass','less',
    'vue','svelte','sh','bash','zsh','lua','r','ex','exs','hs',
    'elm','dart','tf','hcl','yaml','yml','toml','json','sql',
    'graphql','proto','md','mdx','rst',
  ]);
 
  const MANIFEST_NAMES = new Set([
    'package.json','requirements.txt','pipfile','pyproject.toml',
    'cargo.toml','go.mod','pom.xml','build.gradle','gemfile',
    'composer.json','packages.config',
  ]);
 
  async function gather(owner, repo) {
    // 1. Repo meta — always needed first for default_branch
    const meta = await apiFetch(`/repos/${owner}/${repo}`);
    const branch = meta.default_branch;
 
    // 2. Fire remaining calls in parallel
    const [contribs, activity, tree] = await Promise.all([
      apiFetch(`/repos/${owner}/${repo}/contributors?per_page=30`).catch(() => []),
      apiFetch(`/repos/${owner}/${repo}/stats/commit_activity`).catch(() => null),
      apiFetch(`/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`).catch(() => null),
    ]);
 
    // ── LOC ────────────────────────────────────────────────
    const blobs = (tree?.tree || []).filter(f =>
      f.type === 'blob' && TEXT_EXT.has((f.path.split('.').pop() || '').toLowerCase())
    );
    const loc       = Math.round(blobs.reduce((s, f) => s + (f.size || 0), 0) / 30);
    const truncated = tree?.truncated || false;
 
    // ── Manifests ──────────────────────────────────────────
    const manifests = [...new Set(
      (tree?.tree || [])
        .filter(f => f.type === 'blob')
        .map(f => f.path.split('/').pop().toLowerCase())
        .filter(n => MANIFEST_NAMES.has(n) || n.endsWith('.csproj'))
    )];
 
    // ── Bus factor ─────────────────────────────────────────
    let busFactor = null, topContrib = null;
    if (Array.isArray(contribs) && contribs.length) {
      topContrib = contribs[0]?.login;
      const total = contribs.reduce((s, c) => s + c.contributions, 0);
      let cum = 0, i = 0;
      for (; i < contribs.length && cum < total * 0.8; i++) cum += contribs[i].contributions;
      busFactor = i;
    }
 
    // ── Activity spark (26 weeks) ─────────────────────────
    let spark = null, recentCommits = 0;
    if (Array.isArray(activity) && activity.length) {
      const weeks = activity.slice(-26);
      recentCommits = activity.slice(-4).reduce((s, w) => s + w.total, 0);
      const max = Math.max(...weeks.map(w => w.total), 1);
      const bars = '▁▂▃▄▅▆▇█';
      spark = weeks.map(w => bars[Math.min(7, Math.floor((w.total / max) * 8))]).join('');
    }
 
    // ── Age ────────────────────────────────────────────────
    const ageDays  = Math.floor((Date.now() - new Date(meta.created_at)) / 86400000);
    const ageLabel = ageDays < 365
      ? `${Math.floor(ageDays / 30)}mo`
      : `${(ageDays / 365).toFixed(1)}y`;
 
    return {
      loc, truncated, manifests,
      busFactor, topContrib,
      spark, recentCommits,
      ageLabel,
      openIssues: meta.open_issues_count,
      archived: meta.archived,
      fork: meta.fork,
      contribCount: Array.isArray(contribs) ? contribs.length : null,
    };
  }
 
  // ── Render ────────────────────────────────────────────────
  function fmt(n) {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000)     return (n / 1_000).toFixed(1) + 'k';
    return String(n);
  }
 
  const CSS = `
    #${PANEL_ID} {
      margin-top: 16px;
      font-size: 12px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    }
    #${PANEL_ID} .ghi-heading {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: .04em;
      color: var(--fgColor-muted, #656d76);
      margin: 0 0 8px;
    }
    #${PANEL_ID} .ghi-row {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 8px;
      padding: 5px 0;
      border-bottom: 1px solid var(--borderColor-muted, #d0d7de33);
      line-height: 1.4;
    }
    #${PANEL_ID} .ghi-row:last-child { border-bottom: none; }
    #${PANEL_ID} .ghi-lbl {
      color: var(--fgColor-muted, #656d76);
      flex-shrink: 0;
    }
    #${PANEL_ID} .ghi-val {
      font-weight: 500;
      color: var(--fgColor-default, #1f2328);
      text-align: right;
    }
    #${PANEL_ID} .ghi-spark {
      display: block;
      font-family: monospace;
      letter-spacing: 0;
      font-size: 14px;
      line-height: 1;
      margin-top: 3px;
    }
    #${PANEL_ID} .ghi-muted  { color: var(--fgColor-muted, #656d76) !important; }
    #${PANEL_ID} .ghi-green  { color: #1a7f37 !important; }
    #${PANEL_ID} .ghi-amber  { color: #9a6700 !important; }
    #${PANEL_ID} .ghi-red    { color: #cf222e !important; }
    #${PANEL_ID} .ghi-chips  { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 2px; }
    #${PANEL_ID} .ghi-chip {
      font-size: 10px;
      padding: 1px 6px;
      border-radius: 20px;
      border: 0.5px solid currentColor;
      opacity: .75;
      white-space: nowrap;
    }
    #${PANEL_ID} .ghi-tag {
      font-size: 10px;
      font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
      padding: 1px 5px;
      background: var(--bgColor-muted, #f6f8fa);
      border: 0.5px solid var(--borderColor-default, #d0d7de);
      border-radius: 4px;
    }
    #${PANEL_ID} .ghi-stale {
      float: right;
      font-size: 10px;
      color: var(--fgColor-muted, #656d76);
      opacity: .6;
      font-weight: 400;
    }
    @media (prefers-color-scheme: dark) {
      #${PANEL_ID} .ghi-green { color: #3fb950 !important; }
      #${PANEL_ID} .ghi-amber { color: #d29922 !important; }
      #${PANEL_ID} .ghi-red   { color: #f85149 !important; }
      #${PANEL_ID} .ghi-tag   { background: #161b22; border-color: #30363d; }
    }
  `;
 
  function buildPanel(d, stale) {
    const isDead   = d.recentCommits === 0;
    const sparkCol = isDead ? 'ghi-red' : d.recentCommits < 5 ? 'ghi-amber' : 'ghi-green';
    const bfCol    = !d.busFactor ? '' : d.busFactor === 1 ? 'ghi-red' : d.busFactor <= 2 ? 'ghi-amber' : 'ghi-green';
    const bfText   = d.busFactor === null ? '—'
      : d.busFactor === 1 ? `1 person (${d.topContrib})`
      : `${d.busFactor} of ${d.contribCount} devs`;
 
    const chips = [];
    if (d.archived) chips.push(`<span class="ghi-chip ghi-amber">archived</span>`);
    if (d.fork)     chips.push(`<span class="ghi-chip ghi-muted">fork</span>`);
    if (d.busFactor === 1) chips.push(`<span class="ghi-chip ghi-red">solo maintainer</span>`);
    if (isDead && d.openIssues > 0) chips.push(`<span class="ghi-chip ghi-red">inactive + ${d.openIssues} open issues</span>`);
 
    const rows = [];
 
    rows.push(`
      <div class="ghi-row">
        <span class="ghi-lbl">Lines of code</span>
        <span class="ghi-val">${fmt(d.loc)}${d.truncated ? '<span class="ghi-muted" title="Large repo — partial count"> ~</span>' : ''}</span>
      </div>`);
 
    rows.push(`
      <div class="ghi-row">
        <span class="ghi-lbl">Repo age</span>
        <span class="ghi-val">${d.ageLabel}</span>
      </div>`);
 
    if (d.spark) rows.push(`
      <div class="ghi-row" style="flex-direction:column;align-items:stretch">
        <div style="display:flex;justify-content:space-between">
          <span class="ghi-lbl">Commit activity</span>
          <span class="ghi-val ${sparkCol}">${isDead ? 'no recent commits' : `${d.recentCommits} / 4 wks`}</span>
        </div>
        <span class="ghi-spark ${sparkCol}">${d.spark}</span>
      </div>`);
 
    rows.push(`
      <div class="ghi-row">
        <span class="ghi-lbl">Bus factor</span>
        <span class="ghi-val ${bfCol}">${bfText}</span>
      </div>`);
 
    if (d.manifests.length) rows.push(`
      <div class="ghi-row" style="flex-direction:column;align-items:stretch;gap:5px">
        <span class="ghi-lbl">Dependency files</span>
        <div class="ghi-chips">
          ${d.manifests.map(m => `<span class="ghi-tag">${m}</span>`).join('')}
        </div>
      </div>`);
 
    if (chips.length) rows.push(`
      <div class="ghi-row" style="border-bottom:none">
        <div class="ghi-chips">${chips.join('')}</div>
      </div>`);
 
    return `
      <h2 class="ghi-heading">
        Insights
        ${stale ? '<span class="ghi-stale">cached</span>' : ''}
      </h2>
      ${rows.join('')}
    `;
  }
 
  function getAnchor() {
    return document.querySelector('[data-target="about-sidebar.stats"]')
        || document.querySelector('.BorderGrid-cell .f6.color-fg-muted')?.closest('.BorderGrid-cell')
        || document.querySelector('.BorderGrid-cell');
  }
 
  function injectPanel(html) {
    let panel = document.getElementById(PANEL_ID);
    if (!panel) {
      const anchor = getAnchor();
      if (!anchor) return;
      const styleEl = document.createElement('style');
      styleEl.textContent = CSS;
      document.head.appendChild(styleEl);
      panel = document.createElement('div');
      panel.id = PANEL_ID;
      anchor.appendChild(panel);
    }
    panel.innerHTML = html;
  }
 
  // ── Orchestration ─────────────────────────────────────────
  // Stale-while-revalidate: show cached data immediately,
  // then fetch fresh in background and update silently.
 
  async function run() {
    const r = parseRepo();
    if (!r) return;
    if (document.getElementById(PANEL_ID)) return;
 
    const { owner, repo } = r;
    const key   = `ghi3:${owner}/${repo}`;
    const entry = cacheGet(key);
    const age   = entry ? Date.now() - entry.ts : Infinity;
 
    // Show cached data straight away (even if stale up to 24h)
    if (entry && age < STALE_TTL) {
      injectPanel(buildPanel(entry.data, age > CACHE_TTL));
    } else {
      // No usable cache — show skeleton
      injectPanel(`<h2 class="ghi-heading">Insights</h2><span class="ghi-lbl">Loading…</span>`);
    }
 
    // Revalidate if cache is absent or expired
    if (age > CACHE_TTL) {
      try {
        const data = await gather(owner, repo);
        cacheSet(key, data);
        injectPanel(buildPanel(data, false));
      } catch (status) {
        if (!entry) {
          const msg = status === 403
            ? 'Rate limited — <a href="https://github.com/settings/tokens" target="_blank" style="color:inherit">add a token</a>'
            : 'Unavailable';
          injectPanel(`<h2 class="ghi-heading">Insights</h2><span class="ghi-muted ghi-lbl">${msg}</span>`);
        }
        // If we have stale data, keep showing it silently
      }
    }
  }
 
  // ── SPA navigation ────────────────────────────────────────
  let lastPath = '';
  new MutationObserver(() => {
    if (location.pathname !== lastPath) {
      lastPath = location.pathname;
      document.getElementById(PANEL_ID)?.remove();
      setTimeout(run, 800);
    }
  }).observe(document.body, { childList: true, subtree: true });
 
  setTimeout(run, 700);
})();