#!/usr/bin/env node
/**
 * Publish conformance results to GitHub Pages (gh-pages branch).
 *
 * Extracts HTML reports from conformance-result ZIPs, creates a per-run
 * directory, generates an index, and pushes to the gh-pages branch.
 * Keeps the latest N runs and prunes older ones.
 *
 * Usage:
 *   node scripts/publish-pages.mjs <results-dir> \
 *     --run-id <id> --run-url <url> [--max-runs 20] [--pages-base <url>]
 *
 * Environment:
 *   GITHUB_REPOSITORY - owner/repo (for default pages-base)
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { createRequire } from 'module';

// ── Args ───────────────────────────────────────────────────────────────────

const resultsDir = process.argv[2] || './conformance-results';

function getFlag(name) {
  const idx = process.argv.indexOf(name);
  return idx !== -1 && idx + 1 < process.argv.length ? process.argv[idx + 1] : null;
}

const runId = getFlag('--run-id') || process.env.GITHUB_RUN_ID || 'local';
const runUrl = getFlag('--run-url') || '';
const maxRuns = parseInt(getFlag('--max-runs') || '20', 10);
const repo = process.env.GITHUB_REPOSITORY || 'sirosfoundation/siros-conformance';
const pagesBase = getFlag('--pages-base') || `https://${repo.split('/')[0]}.github.io/${repo.split('/')[1]}`;

// ── Helpers ────────────────────────────────────────────────────────────────

function run(cmd, opts = {}) {
  return execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], ...opts }).trim();
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

// ── Collect summary files ──────────────────────────────────────────────────

const summaryFiles = fs.readdirSync(resultsDir).filter(f => f.endsWith('-summary.json'));
const zipFiles = fs.readdirSync(resultsDir).filter(f => f.endsWith('.zip'));

if (summaryFiles.length === 0 && zipFiles.length === 0) {
  console.log('No results to publish');
  process.exit(0);
}

const summaries = summaryFiles.map(f =>
  JSON.parse(fs.readFileSync(path.join(resultsDir, f), 'utf-8'))
);

// ── Set up gh-pages worktree ───────────────────────────────────────────────

const pagesDir = '/tmp/gh-pages-deploy';

// Clean up any previous worktree
try { run(`git worktree remove --force ${pagesDir}`, { stdio: 'ignore' }); } catch {}
if (fs.existsSync(pagesDir)) fs.rmSync(pagesDir, { recursive: true });

// Check if gh-pages branch exists
let ghPagesExists = false;
try {
  run('git rev-parse --verify origin/gh-pages');
  ghPagesExists = true;
} catch {
  try {
    run('git rev-parse --verify gh-pages');
    ghPagesExists = true;
  } catch {}
}

if (ghPagesExists) {
  run(`git worktree add ${pagesDir} gh-pages`);
} else {
  // Create orphan gh-pages branch
  run(`git worktree add --detach ${pagesDir}`);
  run('git checkout --orphan gh-pages', { cwd: pagesDir });
  run('git rm -rf . 2>/dev/null || true', { cwd: pagesDir });
}

// ── Create run directory ───────────────────────────────────────────────────

const runDir = path.join(pagesDir, 'runs', runId);
ensureDir(runDir);

// Extract each ZIP into its own subdirectory
for (const zip of zipFiles) {
  const zipPath = path.resolve(resultsDir, zip);
  // Extract plan ID from filename: conformance-report-<planId>.zip
  const match = zip.match(/conformance-report-(.+)\.zip/);
  const planId = match ? match[1] : zip.replace('.zip', '');

  // Find which summary this plan belongs to
  const summary = summaries.find(s => s.planId === planId);
  const profile = summary?.profile || 'unknown';

  const extractDir = path.join(runDir, profile, planId);
  ensureDir(extractDir);

  try {
    run(`unzip -o "${zipPath}" -d "${extractDir}"`);
  } catch (e) {
    console.error(`Failed to extract ${zip}: ${e.message}`);
  }
}

// Copy summary JSONs
for (const f of summaryFiles) {
  fs.copyFileSync(path.join(resultsDir, f), path.join(runDir, f));
}

// ── Generate per-run index.html ────────────────────────────────────────────

const SIROS_LOGO_SVG = `<svg viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="512" height="512" rx="256" fill="white"/><path fill-rule="evenodd" clip-rule="evenodd" d="M187.096 102.215C199.23 181.029 199.23 181.029 278.044 193.221C199.257 205.35 199.23 205.528 187.108 284.202C187.104 284.229 187.1 284.257 187.096 284.284C174.904 205.412 174.904 205.412 96.0903 193.221C174.904 181.029 174.904 181.029 187.096 102.215ZM193.221 329.469C331.318 308.09 331.318 308.09 352.697 169.935C373.498 304.565 374.018 308.032 501.773 327.851C508.418 305.027 512 280.933 512 256.029C512 114.58 397.42 0 255.971 0C114.58 0 0 114.58 0 256.029C0 397.42 114.58 512 255.971 512C371.245 512 468.664 435.902 500.79 331.202C373.961 350.848 373.441 354.893 352.697 488.887C331.318 350.79 331.318 350.79 193.221 329.469Z" fill="#1C4587"/></svg>`;

const SIROS_CSS = `
  :root { --siros-blue: #1C4587; --siros-light: #f0f4f8; --c-success: #1a7f37; --c-info: #8250df; --c-fail: #cf222e; --c-warn: #9a6700; --c-skip: #8b949e; --c-review: #0969da; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; color: #24292f; background: #fff; }
  .site-header { background: var(--siros-blue); color: #fff; padding: .75rem 0; }
  .site-header .container { max-width: 960px; margin: 0 auto; padding: 0 1rem; display: flex; align-items: center; justify-content: space-between; }
  .site-header a { color: #fff; text-decoration: none; }
  .site-header .logo { display: flex; align-items: center; gap: .5rem; font-weight: 600; font-size: 1.1rem; }
  .site-header .logo svg { flex-shrink: 0; }
  .site-header nav { display: flex; gap: 1.25rem; font-size: .9rem; }
  .site-header nav a:hover { text-decoration: underline; }
  main.container { max-width: 960px; margin: 0 auto; padding: 1.5rem 1rem 3rem; }
  h1 { border-bottom: 2px solid var(--siros-blue); padding-bottom: .5rem; color: var(--siros-blue); }
  h2 { color: var(--siros-blue); margin-top: 2rem; }
  table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
  th, td { border: 1px solid #d0d7de; padding: .5rem .75rem; text-align: left; }
  th { background: var(--siros-light); color: var(--siros-blue); font-weight: 600; }
  a { color: var(--siros-blue); }
  .pass { color: var(--c-success); } .fail { color: var(--c-fail); } .warn { color: var(--c-warn); }
  details { margin: 1rem 0; }
  summary { cursor: pointer; font-weight: 600; color: var(--siros-blue); }
  code { background: var(--siros-light); padding: .15em .35em; border-radius: 3px; font-size: .9em; }
  .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 1rem; margin: 1.5rem 0; }
  .stat-card { background: var(--siros-light); border-radius: 8px; padding: 1rem; text-align: center; border: 1px solid #d0d7de; }
  .stat-card .number { font-size: 1.75rem; font-weight: 700; color: var(--siros-blue); }
  .stat-card .label { font-size: .85rem; color: #57606a; margin-top: .25rem; }
  .breadcrumb { font-size: .9rem; color: #57606a; margin-bottom: 1rem; }
  .breadcrumb a { color: var(--siros-blue); }
  footer { margin-top: 3rem; padding-top: 1.5rem; border-top: 1px solid #d0d7de; text-align: center; font-size: .85rem; color: #57606a; }
  footer a { color: var(--siros-blue); }
  .cbar { display: flex; height: 18px; border-radius: 4px; overflow: hidden; min-width: 120px; border: 1px solid #d0d7de; }
  .cbar span { display: block; height: 100%; }
  .cbar-success { background: var(--c-success); }
  .cbar-info { background: var(--c-info); }
  .cbar-fail { background: var(--c-fail); }
  .cbar-warn { background: var(--c-warn); }
  .cbar-skip { background: var(--c-skip); }
  .cbar-review { background: var(--c-review); }
  .cbar-legend { display: flex; flex-wrap: wrap; gap: .5rem; font-size: .8rem; margin-top: .25rem; }
  .cbar-legend span { display: flex; align-items: center; gap: .2rem; }
  .cbar-legend .dot { width: 10px; height: 10px; border-radius: 2px; display: inline-block; }
  .cbar-wrap { min-width: 180px; }
`;

function htmlHeader(title, extra = '') {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} — SIROS Conformance</title>
  <style>${SIROS_CSS}</style>
  ${extra}
</head>
<body>
  <header class="site-header">
    <div class="container">
      <a href="https://sirosfoundation.github.io/siros-conformance/" class="logo">
        ${SIROS_LOGO_SVG}
        <span>SIROS Conformance</span>
      </a>
      <nav>
        <a href="https://sirosfoundation.github.io/siros-conformance/">Results</a>
        <a href="https://github.com/sirosfoundation/siros-conformance">GitHub</a>
        <a href="https://siros.org">SIROS Foundation</a>
      </nav>
    </div>
  </header>
  <main class="container">
`;
}

function htmlFooter() {
  return `
  </main>
  <footer>
    <p><a href="https://siros.org">SIROS Foundation</a> · <a href="mailto:info@siros.org">info@siros.org</a></p>
    <p>Bredgränd 4, 111 30 Stockholm, Sweden</p>
    <p>Generated by <a href="https://github.com/sirosfoundation/siros-conformance">siros-conformance</a></p>
  </footer>
</body>
</html>`;
}

const PROFILE_LABELS = { 'wallet-vci': 'OID4VCI Wallet', 'wallet-vp': 'OID4VP Wallet', 'issuer': 'OID4VCI Issuer', 'verifier': 'OID4VP Verifier' };

// Condition categories in display order (left→right in the bar)
const COND_CATS = [
  { key: 'SUCCESS',  cls: 'cbar-success', color: '#1a7f37', label: 'Success' },
  { key: 'INFO',     cls: 'cbar-info',    color: '#8250df', label: 'Info' },
  { key: 'WARNING',  cls: 'cbar-warn',    color: '#9a6700', label: 'Warning' },
  { key: 'REVIEW',   cls: 'cbar-review',  color: '#0969da', label: 'Review' },
  { key: 'FAILURE',  cls: 'cbar-fail',    color: '#cf222e', label: 'Failure' },
  { key: 'SKIPPED',  cls: 'cbar-skip',    color: '#8b949e', label: 'Skipped' },
];

function conditionBar(counts, opts = {}) {
  if (!counts || Object.keys(counts).length === 0) return '<span style="color:#8b949e">—</span>';
  const total = COND_CATS.reduce((n, c) => n + (counts[c.key] || 0), 0);
  if (total === 0) return '<span style="color:#8b949e">—</span>';

  const segments = COND_CATS
    .filter(c => counts[c.key])
    .map(c => {
      const pct = ((counts[c.key] / total) * 100).toFixed(1);
      return `<span class="${c.cls}" style="width:${pct}%" title="${c.label}: ${counts[c.key]}"></span>`;
    })
    .join('');

  const legend = COND_CATS
    .filter(c => counts[c.key])
    .map(c => `<span><span class="dot" style="background:${c.color}"></span>${counts[c.key]}</span>`)
    .join('');

  return `<div class="cbar-wrap"><div class="cbar">${segments}</div><div class="cbar-legend">${legend}</div></div>`;
}

function aggregateConditions(modules) {
  const totals = {};
  for (const m of modules) {
    if (!m.conditions) continue;
    for (const [k, v] of Object.entries(m.conditions)) {
      if (k === 'FINISHED') continue;
      totals[k] = (totals[k] || 0) + v;
    }
  }
  return totals;
}

function generateRunIndex(runId, summaries, runUrl) {
  const timestamp = summaries[0]?.timestamp || new Date().toISOString();
  const date = new Date(timestamp).toISOString().replace('T', ' ').replace(/\.\d+Z/, ' UTC');

  const totalPassed = summaries.reduce((n, s) => n + s.passed, 0);
  const totalFailed = summaries.reduce((n, s) => n + s.failed, 0);
  const totalModules = summaries.reduce((n, s) => n + s.total, 0);

  let html = htmlHeader(`Run #${runId}`);

  html += `    <div class="breadcrumb"><a href="../">← All Runs</a></div>\n`;
  html += `    <h1>Conformance Run #${runId}</h1>\n`;

  // Aggregate conditions across all modules
  const allModules = summaries.flatMap(s => s.modules);
  const aggConds = aggregateConditions(allModules);

  // Stats cards with condition totals
  html += `    <div class="stats-grid">\n`;
  html += `      <div class="stat-card"><div class="number">${date.split(' ')[0]}</div><div class="label">Date</div></div>\n`;
  html += `      <div class="stat-card"><div class="number">${totalModules}</div><div class="label">Modules</div></div>\n`;
  for (const c of COND_CATS) {
    if (!aggConds[c.key]) continue;
    html += `      <div class="stat-card"><div class="number" style="color:${c.color}">${aggConds[c.key]}</div><div class="label">${c.label}</div></div>\n`;
  }
  html += `    </div>\n`;

  // Overall condition bar
  html += `    <div style="margin:1rem 0">${conditionBar(aggConds)}</div>\n`;

  if (runUrl) {
    html += `    <p><strong>CI Run:</strong> <a href="${escapeHtml(runUrl)}">${escapeHtml(runUrl)}</a></p>\n`;
  }

  // Metadata
  const meta = summaries[0]?.metadata;
  if (meta?.targetRepo) {
    html += `    <p><strong>Target:</strong> ${escapeHtml(meta.targetRepo)}`;
    if (meta.targetPr) html += ` <a href="https://github.com/${escapeHtml(meta.targetRepo)}/pull/${escapeHtml(meta.targetPr)}">#${escapeHtml(meta.targetPr)}</a>`;
    html += `</p>\n`;
  }

  for (const s of summaries) {
    const label = PROFILE_LABELS[s.profile] || s.profile;
    const profileConds = aggregateConditions(s.modules);

    html += `    <h2>${label}</h2>\n`;
    html += `    <p>Variant: <code>${escapeHtml(s.variant || 'default')}</code> · ${s.total} modules</p>\n`;
    html += `    <div style="margin:.5rem 0">${conditionBar(profileConds)}</div>\n`;
    html += `    <table>\n      <tr><th>Module</th><th>Conditions</th><th>Report</th></tr>\n`;

    for (const m of s.modules) {
      const reportLink = `${s.profile}/${s.planId}/`;
      html += `      <tr><td><code>${escapeHtml(m.module)}</code></td><td>${conditionBar(m.conditions || {})}</td><td><a href="${reportLink}">report</a></td></tr>\n`;
    }
    html += `    </table>\n`;

    const failedModules = s.modules.filter(m => !m.passed && m.failures?.length > 0);
    if (failedModules.length > 0) {
      html += `    <details><summary>Failure details (${failedModules.reduce((n, m) => n + m.failures.length, 0)} conditions)</summary>\n`;
      for (const m of failedModules) {
        html += `      <h4><code>${escapeHtml(m.module)}</code></h4>\n      <ul>\n`;
        for (const f of m.failures) {
          html += `        <li><strong>${escapeHtml(f.src)}</strong>: ${escapeHtml(f.msg)}</li>\n`;
        }
        html += `      </ul>\n`;
      }
      html += `    </details>\n`;
    }
  }

  html += htmlFooter();
  return html;
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

fs.writeFileSync(path.join(runDir, 'index.html'), generateRunIndex(runId, summaries, runUrl));

// ── Generate top-level index.html ──────────────────────────────────────────

function generateTopIndex(pagesDir, pagesBase) {
  const runsDir = path.join(pagesDir, 'runs');
  if (!fs.existsSync(runsDir)) return htmlHeader('No Results') + '<p>No conformance runs yet.</p>' + htmlFooter();

  const runs = [];
  for (const entry of fs.readdirSync(runsDir)) {
    const entryPath = path.join(runsDir, entry);
    if (!fs.statSync(entryPath).isDirectory()) continue;

    const summaryFiles = fs.readdirSync(entryPath).filter(f => f.endsWith('-summary.json'));
    let timestamp = null;
    let totalPassed = 0;
    let totalFailed = 0;
    let totalModules = 0;
    const profiles = [];
    const summaryData = [];
    let targetRepo = '';
    let targetPr = '';
    const condTotals = {};

    for (const sf of summaryFiles) {
      try {
        const s = JSON.parse(fs.readFileSync(path.join(entryPath, sf), 'utf-8'));
        if (!timestamp) timestamp = s.timestamp;
        totalPassed += s.passed || 0;
        totalFailed += s.failed || 0;
        totalModules += s.total || 0;
        profiles.push(s.profile);
        if (s.metadata?.targetRepo) targetRepo = s.metadata.targetRepo;
        if (s.metadata?.targetPr) targetPr = s.metadata.targetPr;
        // Aggregate conditions
        for (const m of (s.modules || [])) {
          if (!m.conditions) continue;
          for (const [k, v] of Object.entries(m.conditions)) {
            if (k === 'FINISHED') continue;
            condTotals[k] = (condTotals[k] || 0) + v;
          }
        }
      } catch {}
    }

    runs.push({ id: entry, timestamp: timestamp || fs.statSync(entryPath).mtime.toISOString(), totalPassed, totalFailed, totalModules, profiles, targetRepo, targetPr, condTotals });
  }

  runs.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  let html = htmlHeader('Conformance Results');
  html += `    <h1>SIROS Conformance Results</h1>\n`;
  html += `    <p>Historical conformance test results from the <a href="https://github.com/sirosfoundation/siros-conformance">siros-conformance</a> test suite.</p>\n`;

  // Stats
  if (runs.length > 0) {
    html += `    <div class="stats-grid">\n`;
    html += `      <div class="stat-card"><div class="number">${runs.length}</div><div class="label">Total Runs</div></div>\n`;
    html += `      <div class="stat-card"><div class="number">${runs[0].totalModules}</div><div class="label">Modules (latest)</div></div>\n`;
    for (const c of COND_CATS) {
      if (!runs[0].condTotals[c.key]) continue;
      html += `      <div class="stat-card"><div class="number" style="color:${c.color}">${runs[0].condTotals[c.key]}</div><div class="label">${c.label} (latest)</div></div>\n`;
    }
    html += `    </div>\n`;
    html += `    <div style="margin:0 0 1.5rem">${conditionBar(runs[0].condTotals)}</div>\n`;
  }

  html += `    <table>\n`;
  html += `      <tr><th>Run</th><th>Date</th><th>Target</th><th>Profiles</th><th>Conditions</th></tr>\n`;

  for (const r of runs) {
    const date = new Date(r.timestamp).toISOString().replace('T', ' ').replace(/\.\d+Z/, ' UTC');
    const profileLabels = r.profiles.map(p => ({ 'wallet-vci': 'VCI', 'wallet-vp': 'VP', 'issuer': 'Issuer', 'verifier': 'Verifier' }[p] || p)).join(', ');
    let target = '';
    if (r.targetRepo) {
      const short = r.targetRepo.split('/').pop();
      target = r.targetPr ? `<a href="https://github.com/${escapeHtml(r.targetRepo)}/pull/${escapeHtml(r.targetPr)}">${escapeHtml(short)}#${escapeHtml(r.targetPr)}</a>` : escapeHtml(short);
    }
    html += `      <tr><td><a href="runs/${r.id}/">#${r.id}</a></td><td>${date}</td><td>${target}</td><td>${profileLabels}</td><td>${conditionBar(r.condTotals)}</td></tr>\n`;
  }

  html += `    </table>\n`;
  html += htmlFooter();
  return html;
}

// ── Prune old runs ─────────────────────────────────────────────────────────

const runsDir = path.join(pagesDir, 'runs');
if (fs.existsSync(runsDir)) {
  const allRuns = fs.readdirSync(runsDir)
    .filter(d => fs.statSync(path.join(runsDir, d)).isDirectory())
    .map(d => {
      // Try to read timestamp from summary
      const sFiles = fs.readdirSync(path.join(runsDir, d)).filter(f => f.endsWith('-summary.json'));
      let ts = null;
      for (const sf of sFiles) {
        try {
          const s = JSON.parse(fs.readFileSync(path.join(runsDir, d, sf), 'utf-8'));
          if (s.timestamp) { ts = s.timestamp; break; }
        } catch {}
      }
      return { dir: d, timestamp: ts || fs.statSync(path.join(runsDir, d)).mtime.toISOString() };
    })
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  if (allRuns.length > maxRuns) {
    for (const old of allRuns.slice(maxRuns)) {
      console.log(`Pruning old run: ${old.dir}`);
      fs.rmSync(path.join(runsDir, old.dir), { recursive: true });
    }
  }
}

// Write top-level index
fs.writeFileSync(path.join(pagesDir, 'index.html'), generateTopIndex(pagesDir, pagesBase));

// Also create a .nojekyll file so GitHub Pages serves files as-is
fs.writeFileSync(path.join(pagesDir, '.nojekyll'), '');

// ── Commit and push ────────────────────────────────────────────────────────

try {
  run('git config user.email "github-actions[bot]@users.noreply.github.com"', { cwd: pagesDir });
  run('git config user.name "github-actions[bot]"', { cwd: pagesDir });
  run('git add -A', { cwd: pagesDir });
  const status = run('git status --porcelain', { cwd: pagesDir });
  if (status) {
    run(`git commit -m "Conformance results for run ${runId}"`, { cwd: pagesDir });
    run('git push origin gh-pages', { cwd: pagesDir });
    console.log(`Published results to ${pagesBase}/runs/${runId}/`);
  } else {
    console.log('No changes to publish');
  }
} finally {
  try { run(`git worktree remove --force ${pagesDir}`); } catch {}
}

// ── Output the pages URL for downstream steps ─────────────────────────────

const pagesUrl = `${pagesBase}/runs/${runId}/`;
console.log(`PAGES_URL=${pagesUrl}`);

// Write to GITHUB_OUTPUT if available
if (process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `PAGES_URL=${pagesUrl}\n`);
}
