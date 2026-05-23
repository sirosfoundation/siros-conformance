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

function generateRunIndex(runId, summaries, runUrl) {
  const timestamp = summaries[0]?.timestamp || new Date().toISOString();
  const date = new Date(timestamp).toISOString().replace('T', ' ').replace(/\.\d+Z/, ' UTC');

  let html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Conformance Run ${runId}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 900px; margin: 2rem auto; padding: 0 1rem; color: #24292f; }
    h1 { border-bottom: 1px solid #d0d7de; padding-bottom: .5rem; }
    table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
    th, td { border: 1px solid #d0d7de; padding: .5rem .75rem; text-align: left; }
    th { background: #f6f8fa; }
    .pass { color: #1a7f37; } .fail { color: #cf222e; }
    a { color: #0969da; }
    .conditions { font-size: 0.85em; color: #57606a; }
    details { margin: 1rem 0; }
    summary { cursor: pointer; font-weight: 600; }
    pre { background: #f6f8fa; padding: .75rem; border-radius: 6px; overflow-x: auto; font-size: 0.85em; }
  </style>
</head>
<body>
  <h1>Conformance Run #${runId}</h1>
  <p><strong>Date:</strong> ${date}</p>
  ${runUrl ? `<p><strong>CI Run:</strong> <a href="${runUrl}">${runUrl}</a></p>` : ''}
  <p><a href="../">&larr; All runs</a></p>
`;

  for (const s of summaries) {
    const label = { 'wallet-vci': 'OID4VCI Wallet', 'wallet-vp': 'OID4VP Wallet', 'issuer': 'OID4VCI Issuer', 'verifier': 'OID4VP Verifier' }[s.profile] || s.profile;
    const icon = s.failed === 0 ? '✅' : '❌';

    html += `  <h2>${icon} ${label}</h2>\n`;
    html += `  <p>Variant: <code>${s.variant || 'default'}</code> | Modules: ${s.total} (${s.passed} passed, ${s.failed} failed)</p>\n`;
    html += `  <table>\n    <tr><th>Module</th><th>Result</th><th>Conditions</th><th>Report</th></tr>\n`;

    for (const m of s.modules) {
      const cls = m.passed ? 'pass' : 'fail';
      const icon = m.passed ? '✅' : '❌';
      const conds = m.conditions || {};
      const condStr = Object.entries(conds)
        .filter(([k]) => k !== 'FINISHED')
        .map(([k, v]) => `${k}:${v}`)
        .join(' ');

      // Link to the extracted HTML report
      const reportLink = `${s.profile}/${s.planId}/`;

      html += `    <tr><td><code>${m.module}</code></td><td class="${cls}">${icon} ${m.result}</td><td class="conditions">${condStr}</td><td><a href="${reportLink}">report</a></td></tr>\n`;
    }
    html += `  </table>\n`;

    // Show failure details
    const failedModules = s.modules.filter(m => !m.passed && m.failures?.length > 0);
    if (failedModules.length > 0) {
      html += `  <details><summary>Failure details</summary>\n`;
      for (const m of failedModules) {
        html += `  <h4>${m.module}</h4>\n  <ul>\n`;
        for (const f of m.failures) {
          html += `    <li><strong>${escapeHtml(f.src)}</strong>: ${escapeHtml(f.msg)}</li>\n`;
        }
        html += `  </ul>\n`;
      }
      html += `  </details>\n`;
    }
  }

  html += `</body></html>`;
  return html;
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

fs.writeFileSync(path.join(runDir, 'index.html'), generateRunIndex(runId, summaries, runUrl));

// ── Generate top-level index.html ──────────────────────────────────────────

function generateTopIndex(pagesDir, pagesBase) {
  const runsDir = path.join(pagesDir, 'runs');
  if (!fs.existsSync(runsDir)) return '<html><body><p>No runs yet.</p></body></html>';

  // Collect all runs with their metadata
  const runs = [];
  for (const entry of fs.readdirSync(runsDir)) {
    const entryPath = path.join(runsDir, entry);
    if (!fs.statSync(entryPath).isDirectory()) continue;

    // Read any summary file to get timestamp
    const summaryFiles = fs.readdirSync(entryPath).filter(f => f.endsWith('-summary.json'));
    let timestamp = null;
    let totalPassed = 0;
    let totalFailed = 0;
    let totalModules = 0;
    const profiles = [];

    for (const sf of summaryFiles) {
      try {
        const s = JSON.parse(fs.readFileSync(path.join(entryPath, sf), 'utf-8'));
        if (!timestamp) timestamp = s.timestamp;
        totalPassed += s.passed || 0;
        totalFailed += s.failed || 0;
        totalModules += s.total || 0;
        profiles.push(s.profile);
      } catch {}
    }

    runs.push({
      id: entry,
      timestamp: timestamp || fs.statSync(entryPath).mtime.toISOString(),
      totalPassed,
      totalFailed,
      totalModules,
      profiles,
    });
  }

  // Sort newest first
  runs.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  let html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>SIROS Conformance Results</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 900px; margin: 2rem auto; padding: 0 1rem; color: #24292f; }
    h1 { border-bottom: 1px solid #d0d7de; padding-bottom: .5rem; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #d0d7de; padding: .5rem .75rem; text-align: left; }
    th { background: #f6f8fa; }
    a { color: #0969da; }
    .pass { color: #1a7f37; } .fail { color: #cf222e; }
  </style>
</head>
<body>
  <h1>SIROS Conformance Results</h1>
  <p>Historical conformance test results from <a href="https://github.com/${repo}">siros-conformance</a>.</p>
  <table>
    <tr><th>Run</th><th>Date</th><th>Profiles</th><th>Passed</th><th>Failed</th><th>Total</th><th>Result</th></tr>
`;

  for (const r of runs) {
    const date = new Date(r.timestamp).toISOString().replace('T', ' ').replace(/\.\d+Z/, ' UTC');
    const icon = r.totalFailed === 0 ? '✅' : '❌';
    const profileLabels = r.profiles.map(p =>
      ({ 'wallet-vci': 'VCI', 'wallet-vp': 'VP', 'issuer': 'Issuer', 'verifier': 'Verifier' }[p] || p)
    ).join(', ');
    html += `    <tr><td><a href="runs/${r.id}/">${r.id}</a></td><td>${date}</td><td>${profileLabels}</td><td>${r.totalPassed}</td><td>${r.totalFailed}</td><td>${r.totalModules}</td><td>${icon}</td></tr>\n`;
  }

  html += `  </table>
</body></html>`;
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
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `pages-url=${pagesUrl}\n`);
}
