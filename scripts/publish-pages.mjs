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

// Copy logo to pages root for navbar
const logoSrc = path.resolve('static/siros-logo.png');
if (fs.existsSync(logoSrc)) {
  fs.copyFileSync(logoSrc, path.join(pagesDir, 'siros-logo.png'));
} else {
  // Try from trust-lists or other known location
  const altLogo = path.resolve('../trust-lists/static/siros-logo.png');
  if (fs.existsSync(altLogo)) {
    fs.copyFileSync(altLogo, path.join(pagesDir, 'siros-logo.png'));
  }
}

// ── Generate per-run index.html ────────────────────────────────────────────

const GITHUB_SVG = `<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" clip-rule="evenodd" d="M12 .5C5.73.5.66 5.57.66 11.84c0 5.02 3.25 9.27 7.76 10.77.57.1.78-.25.78-.55 0-.27-.01-1-.02-1.96-3.16.69-3.83-1.52-3.83-1.52-.52-1.32-1.27-1.67-1.27-1.67-1.04-.71.08-.69.08-.69 1.15.08 1.76 1.18 1.76 1.18 1.02 1.76 2.69 1.25 3.34.96.1-.74.4-1.25.72-1.54-2.52-.29-5.18-1.26-5.18-5.6 0-1.24.44-2.25 1.17-3.04-.12-.29-.51-1.45.11-3.02 0 0 .96-.31 3.15 1.16.91-.25 1.89-.38 2.86-.38.97 0 1.95.13 2.86.38 2.18-1.47 3.14-1.16 3.14-1.16.62 1.57.23 2.73.11 3.02.73.79 1.17 1.8 1.17 3.04 0 4.35-2.67 5.31-5.21 5.59.41.35.78 1.05.78 2.12 0 1.53-.01 2.76-.01 3.14 0 .31.21.66.79.55 4.5-1.5 7.75-5.75 7.75-10.77C23.34 5.57 18.27.5 12 .5Z"/></svg>`;

// Post-process conformance suite report HTML to inject SIROS branding.
// Uses marker comments (<!-- siros:brand:* -->) so branding can be cleanly
// stripped and re-applied regardless of changes to the conformance suite output.
const SIROS_BRAND_HEAD_START = '<!-- siros:brand:head -->';
const SIROS_BRAND_HEAD_END   = '<!-- /siros:brand:head -->';
const SIROS_BRAND_BODY_START = '<!-- siros:brand:body-start -->';
const SIROS_BRAND_BODY_END   = '<!-- /siros:brand:body-start -->';
const SIROS_BRAND_BODY_CLOSE_START = '<!-- siros:brand:body-end -->';
const SIROS_BRAND_BODY_CLOSE_END   = '<!-- /siros:brand:body-end -->';

function stripBranding(html) {
  // Remove each marker pair and everything between them
  html = html.replace(new RegExp(`${escapeRegExp(SIROS_BRAND_HEAD_START)}[\\s\\S]*?${escapeRegExp(SIROS_BRAND_HEAD_END)}\\n?`), '');
  html = html.replace(new RegExp(`${escapeRegExp(SIROS_BRAND_BODY_START)}[\\s\\S]*?${escapeRegExp(SIROS_BRAND_BODY_END)}\\n?`), '');
  html = html.replace(new RegExp(`${escapeRegExp(SIROS_BRAND_BODY_CLOSE_START)}[\\s\\S]*?${escapeRegExp(SIROS_BRAND_BODY_CLOSE_END)}\\n?`), '');
  return html;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function brandReportHtml(htmlFile, backUrl, runId) {
  let html = fs.readFileSync(htmlFile, 'utf-8');

  // Always strip existing branding first (idempotent re-application)
  if (html.includes(SIROS_BRAND_HEAD_START)) {
    html = stripBranding(html);
  }

  const brandCss = `
    .siros-report-nav { background: #fff; border-bottom: 1px solid #e0e0e0; position: sticky; top: 0; z-index: 100; font-family: 'Helvetica Neue', Arial, system-ui, sans-serif; }
    .siros-report-nav .sri { max-width: 1400px; margin: 0 auto; padding: 0.6rem 2rem; display: flex; align-items: center; }
    .siros-report-nav .srb { display: flex; align-items: center; gap: 0.6rem; text-decoration: none; color: #1C4587; font-weight: 600; font-size: 1.1rem; }
    .siros-report-nav .srb img { height: 40px; width: auto; }
    .siros-report-nav .srl { margin-left: auto; display: flex; gap: 1.25rem; align-items: center; }
    .siros-report-nav .srl a { color: #555; text-decoration: none; font-size: 0.875rem; font-weight: 500; transition: color 0.2s; }
    .siros-report-nav .srl a:hover { color: #1C4587; }
    .siros-report-nav .srl svg { width: 20px; height: 20px; fill: #555; transition: fill 0.2s; }
    .siros-report-nav .srl a:hover svg { fill: #1C4587; }
    .siros-report-container { max-width: 1400px; margin: 0 auto; padding: 1.5rem 2rem 3rem; }
    .siros-report-container table { border-collapse: collapse; }
    .siros-report-container table td, .siros-report-container table th { border: 1px solid #d0d7de; padding: 0.4rem 0.6rem; }
    .siros-report-container #header th { background: #f6f8fa; }
    body { padding: 0 !important; margin: 0 !important; }
    .siros-report-footer { border-top: 1px solid #e0e0e0; margin-top: 3rem; padding: 2.5rem 0; font-size: 0.875rem; color: #555; font-family: 'Helvetica Neue', Arial, system-ui, sans-serif; }
    .siros-report-footer .sfi { max-width: 1400px; margin: 0 auto; padding: 0 2rem; display: flex; align-items: flex-start; justify-content: space-between; gap: 2rem; }
    .siros-report-footer .sfa { display: flex; flex-direction: column; gap: 0.25rem; }
    .siros-report-footer .sfa a { color: #555; text-decoration: none; transition: color 0.2s; }
    .siros-report-footer .sfa a:hover { color: #1C4587; }
    .siros-report-footer address { font-style: normal; }
    .siros-report-footer .sfo { font-weight: 600; color: #1a1a1a; margin: 0; }
    .siros-report-footer .sfo a { color: inherit; text-decoration: none; }
    .siros-report-footer .sfo a:hover { color: #1C4587; }
    .siros-report-footer .sfn { display: flex; align-items: center; gap: 1.5rem; flex-wrap: wrap; padding-top: 0.5rem; }
    .siros-report-footer .sfn a { color: #555; text-decoration: none; transition: color 0.2s; }
    .siros-report-footer .sfn a:hover { color: #1C4587; }
    .siros-report-footer .sfn svg { width: 20px; height: 20px; fill: #555; transition: fill 0.2s; }
    .siros-report-footer .sfn a:hover svg { fill: #1C4587; }
    .siros-report-footer .sbi { font-size: 0.75rem; color: #888; margin-top: 1rem; }
    .siros-report-footer .sbi a { color: inherit; }
    @media (max-width: 640px) { .siros-report-footer .sfi { flex-direction: column; gap: 1.5rem; } }
  `;

  const navHtml = `<nav class="siros-report-nav"><div class="sri"><a href="${pagesBase}/" class="srb"><img src="${pagesBase}/siros-logo.png" alt="SIROS Foundation"><span>Conformance</span></a><div class="srl"><a href="${escapeHtml(backUrl)}">← Run #${escapeHtml(runId)}</a><a href="${pagesBase}/">All Runs</a><a href="https://github.com/sirosfoundation/siros-conformance" aria-label="GitHub">${GITHUB_SVG}</a></div></div></nav>`;

  const footerHtml = `<footer class="siros-report-footer"><div class="sfi"><div class="sfa"><p class="sfo"><a href="https://siros.org">SIROS Foundation</a></p><a href="mailto:info@siros.org">info@siros.org</a><address>Bredgränd 4<br>111 30 Stockholm<br>Sweden</address></div><nav class="sfn"><a href="https://siros.org">SIROS Foundation</a><a href="https://developers.siros.org">Developer Docs</a><a href="https://compliance.siros.org">Compliance</a><a href="https://trust.siros.org">Trust Lists</a><a href="https://www.certification.openid.net/">OpenID Conformance</a><a href="https://github.com/sirosfoundation" aria-label="SIROS Foundation on GitHub">${GITHUB_SVG}</a></nav></div><div class="sfi"><p class="sbi">Generated by <a href="https://github.com/sirosfoundation/siros-conformance">siros-conformance</a></p></div></footer>`;

  // Inject CSS before </head> — suite's own <style> is untouched
  html = html.replace('</head>',
    `${SIROS_BRAND_HEAD_START}\n<style>${brandCss}</style>\n${SIROS_BRAND_HEAD_END}\n</head>`);

  // Inject nav + container wrapper after <body>
  html = html.replace(/<body([^>]*)>/,
    (_, attrs) => `<body${attrs}>\n${SIROS_BRAND_BODY_START}\n${navHtml}\n<div class="siros-report-container">\n${SIROS_BRAND_BODY_END}`);

  // Inject container close + footer before </body>
  html = html.replace('</body>',
    `${SIROS_BRAND_BODY_CLOSE_START}\n</div>\n${footerHtml}\n${SIROS_BRAND_BODY_CLOSE_END}\n</body>`);

  fs.writeFileSync(htmlFile, html);
}

// Brand all extracted report HTML files
function brandExtractedReports(runDir, runId) {
  const backUrl = `${pagesBase}/runs/${runId}/`;
  function walkDir(dir) {
    for (const entry of fs.readdirSync(dir)) {
      const full = path.join(dir, entry);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        walkDir(full);
      } else if (entry.endsWith('.html') && entry !== 'index.html') {
        // Don't brand our own generated index.html
        brandReportHtml(full, backUrl, runId);
      } else if (entry === 'index.html') {
        // Also brand the plan-detail index but only if it's a conformance suite page
        const content = fs.readFileSync(full, 'utf-8');
        if (content.includes('Plan details') || content.includes('plan-detail')) {
          brandReportHtml(full, backUrl, runId);
        }
      }
    }
  }
  walkDir(runDir);
}

const SIROS_CSS = `
  :root { --siros-blue: #1C4587; --siros-light: #f0f4f8; --c-success: #1a7f37; --c-info: #8250df; --c-fail: #cf222e; --c-warn: #9a6700; --c-skip: #8b949e; --c-review: #0969da; }
  * { box-sizing: border-box; }
  body { font-family: 'Helvetica Neue', Arial, system-ui, sans-serif; margin: 0; color: #24292f; background: #fff; }
  .navbar { background: #fff; border-bottom: 1px solid #e0e0e0; position: sticky; top: 0; z-index: 100; }
  .navbar-inner { max-width: 1400px; margin: 0 auto; padding: 0.6rem 2rem; display: flex; align-items: center; }
  .navbar-brand { display: flex; align-items: center; gap: 0.6rem; text-decoration: none; color: #1C4587; font-weight: 600; font-size: 1.1rem; }
  .navbar-brand img { height: 40px; width: auto; }
  .navbar-links { margin-left: auto; display: flex; gap: 1.25rem; align-items: center; }
  .navbar-links a { color: #555; text-decoration: none; font-size: 0.875rem; font-weight: 500; transition: color 0.2s; }
  .navbar-links a:hover { color: #1C4587; }
  .navbar-links svg { width: 20px; height: 20px; fill: #555; transition: fill 0.2s; }
  .navbar-links a:hover svg { fill: #1C4587; }
  main.container { max-width: 1400px; margin: 0 auto; padding: 1.5rem 2rem 3rem; }
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
  .footer { border-top: 1px solid #e0e0e0; margin-top: 3rem; padding: 2.5rem 0; font-size: 0.875rem; color: #555; }
  .footer-inner { max-width: 1400px; margin: 0 auto; padding: 0 2rem; display: flex; align-items: flex-start; justify-content: space-between; gap: 2rem; }
  .footer-address { display: flex; flex-direction: column; gap: 0.25rem; }
  .footer-address a { color: #555; text-decoration: none; transition: color 0.2s; }
  .footer-address a:hover { color: #1C4587; }
  .footer-address address { font-style: normal; }
  .footer-org { font-weight: 600; color: #1a1a1a; margin: 0; }
  .footer-org a { color: inherit; text-decoration: none; }
  .footer-org a:hover { color: #1C4587; }
  .footer-nav { display: flex; align-items: center; gap: 1.5rem; flex-wrap: wrap; padding-top: 0.5rem; }
  .footer-nav a { color: #555; text-decoration: none; transition: color 0.2s; }
  .footer-nav a:hover { color: #1C4587; }
  .footer-nav svg { width: 20px; height: 20px; fill: #555; transition: fill 0.2s; }
  .footer-nav a:hover svg { fill: #1C4587; }
  .build-info { font-size: 0.75rem; color: #888; margin-top: 1rem; }
  .build-info a { color: inherit; }
  @media (max-width: 640px) {
    .footer-inner { flex-direction: column; gap: 1.5rem; }
    .footer-nav { justify-content: flex-start; }
  }
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
  <nav class="navbar">
    <div class="navbar-inner">
      <a href="${pagesBase}/" class="navbar-brand">
        <img src="${pagesBase}/siros-logo.png" alt="SIROS Foundation">
        <span>Conformance</span>
      </a>
      <div class="navbar-links">
        <a href="https://developers.siros.org">Developer Docs</a>
        <a href="https://compliance.siros.org">Compliance</a>
        <a href="https://trust.siros.org">Trust Lists</a><a href="https://www.certification.openid.net/">OpenID Conformance</a>
        <a href="https://github.com/sirosfoundation/siros-conformance" aria-label="SIROS Conformance on GitHub">${GITHUB_SVG}</a>
      </div>
    </div>
  </nav>
  <main class="container">
`;
}

function htmlFooter() {
  return `
  </main>
  <footer class="footer">
    <div class="footer-inner">
      <div class="footer-address">
        <p class="footer-org"><a href="https://siros.org">SIROS Foundation</a></p>
        <a href="mailto:info@siros.org">info@siros.org</a>
        <address>Bredgränd 4<br>111 30 Stockholm<br>Sweden</address>
      </div>
      <nav class="footer-nav">
        <a href="https://siros.org">SIROS Foundation</a>
        <a href="https://developers.siros.org">Developer Docs</a>
        <a href="https://compliance.siros.org">Compliance</a>
        <a href="https://trust.siros.org">Trust Lists</a><a href="https://www.certification.openid.net/">OpenID Conformance</a>
        <a href="https://github.com/sirosfoundation" aria-label="SIROS Foundation on GitHub">${GITHUB_SVG}</a>
      </nav>
    </div>
    <div class="footer-inner">
      <p class="build-info">Generated by <a href="https://github.com/sirosfoundation/siros-conformance">siros-conformance</a></p>
    </div>
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

  html += `    <div class="breadcrumb"><a href="${pagesBase}/">← All Runs</a></div>\n`;
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
  if (meta?.goldenRelease) {
    html += `    <p><strong>Golden release:</strong> <code>${escapeHtml(meta.goldenRelease)}</code></p>\n`;
  }
  if (meta?.actor) {
    html += `    <p><strong>Triggered by:</strong> <a href="https://github.com/${escapeHtml(meta.actor)}">${escapeHtml(meta.actor)}</a></p>\n`;
  }
  if (meta?.sha) {
    const shortSha = meta.sha.slice(0, 7);
    const repo = meta.targetRepo || 'sirosfoundation/siros-conformance';
    html += `    <p><strong>Commit:</strong> <a href="https://github.com/${escapeHtml(repo)}/commit/${escapeHtml(meta.sha)}"><code>${escapeHtml(shortSha)}</code></a>`;
    if (meta.ref) html += ` (${escapeHtml(meta.ref.replace('refs/heads/', ''))})`;
    html += `</p>\n`;
  }
  if (meta?.images) {
    const imageEntries = Object.entries(meta.images).filter(([, v]) => v);
    if (imageEntries.length > 0) {
      html += `    <details><summary>Container images</summary>\n    <ul>\n`;
      for (const [service, image] of imageEntries) {
        html += `      <li><code>${escapeHtml(service)}</code>: <code>${escapeHtml(image)}</code></li>\n`;
      }
      html += `    </ul>\n    </details>\n`;
    }
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

// Brand conformance suite report pages with SIROS navbar + back-links
brandExtractedReports(runDir, runId);

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
