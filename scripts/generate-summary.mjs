#!/usr/bin/env node
/**
 * Generate a Markdown summary from conformance result JSON files.
 *
 * Reads *-summary.json files from the results directory and produces
 * a markdown comment suitable for posting on a GitHub PR.
 *
 * Usage:
 *   node scripts/generate-summary.mjs [results-dir] [--run-url URL] [--pages-url URL]
 *
 * Output goes to stdout; pipe or redirect as needed.
 */

import * as fs from 'fs';
import * as path from 'path';

const resultsDir = process.argv[2] || './conformance-results';
const runUrlIdx = process.argv.indexOf('--run-url');
const runUrl = runUrlIdx !== -1 ? process.argv[runUrlIdx + 1] : process.env.GITHUB_RUN_URL || '';
const pagesUrlIdx = process.argv.indexOf('--pages-url');
const pagesUrl = pagesUrlIdx !== -1 ? process.argv[pagesUrlIdx + 1] : '';

// ── Collect summaries ──────────────────────────────────────────────────────

const summaryFiles = fs.readdirSync(resultsDir)
  .filter(f => f.endsWith('-summary.json'))
  .sort();

if (summaryFiles.length === 0) {
  console.error(`No summary files found in ${resultsDir}`);
  process.exit(1);
}

const summaries = summaryFiles.map(f =>
  JSON.parse(fs.readFileSync(path.join(resultsDir, f), 'utf-8'))
);

// ── Helpers ────────────────────────────────────────────────────────────────

const PROFILE_LABELS = {
  'issuer': 'OID4VCI Issuer',
  'verifier': 'OID4VP Verifier',
  'wallet-vci': 'OID4VCI Wallet',
  'wallet-vp': 'OID4VP Wallet',
};

// Condition categories in display order (left→right in the bar)
const COND_CATS = [
  { key: 'SUCCESS',  color: '#1a7f37', label: 'Success' },
  { key: 'INFO',     color: '#8250df', label: 'Info' },
  { key: 'WARNING',  color: '#9a6700', label: 'Warning' },
  { key: 'REVIEW',   color: '#0969da', label: 'Review' },
  { key: 'FAILURE',  color: '#cf222e', label: 'Failure' },
  { key: 'SKIPPED',  color: '#8b949e', label: 'Skipped' },
];

function conditionBarMd(counts) {
  if (!counts || Object.keys(counts).length === 0) return '—';
  const total = COND_CATS.reduce((n, c) => n + (counts[c.key] || 0), 0);
  if (total === 0) return '—';

  // Build an inline HTML progress bar using spans with background colors
  const segments = COND_CATS
    .filter(c => counts[c.key])
    .map(c => {
      const pct = ((counts[c.key] / total) * 100).toFixed(1);
      return '<span style="display:inline-block;height:14px;width:' + pct + '%;background:' + c.color + '" title="' + c.label + ': ' + counts[c.key] + '"></span>';
    })
    .join('');

  const bar = '<span style="display:inline-flex;height:14px;width:120px;border-radius:3px;overflow:hidden;border:1px solid #d0d7de;vertical-align:middle">' + segments + '</span>';

  // Legend with counts
  const legend = COND_CATS
    .filter(c => counts[c.key])
    .map(c => '<span style="color:' + c.color + '">' + counts[c.key] + '</span>')
    .join('/');

  return bar + ' ' + legend;
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

// ── Build markdown ─────────────────────────────────────────────────────────

const lines = [];

// Header
const allModules = summaries.flatMap(s => s.modules);
const aggConds = aggregateConditions(allModules);
const totalFailed = aggConds.FAILURE || 0;
const allPassed = totalFailed === 0;

lines.push(`## ${allPassed ? '✅' : '❌'} Conformance Results`);
lines.push('');
lines.push(conditionBarMd(aggConds));
lines.push('');

// Overview table
lines.push('| Profile | Conditions |');
lines.push('|---------|------------|');
for (const s of summaries) {
  const label = PROFILE_LABELS[s.profile] || s.profile;
  const profileConds = aggregateConditions(s.modules);
  lines.push(`| ${label} | ${conditionBarMd(profileConds)} |`);
}
lines.push('');

// Per-profile detail with conditions
for (const s of summaries) {
  const label = PROFILE_LABELS[s.profile] || s.profile;
  lines.push(`### ${label}`);
  lines.push('');
  lines.push('| Module | Conditions |');
  lines.push('|--------|------------|');
  for (const m of s.modules) {
    lines.push(`| \`${m.module}\` | ${conditionBarMd(m.conditions)} |`);
  }
  lines.push('');

  // Inline failure details
  const failedModules = s.modules.filter(m => m.failures && m.failures.length > 0);
  if (failedModules.length > 0) {
    lines.push('<details>');
    lines.push(`<summary>Failure details (${failedModules.reduce((n, m) => n + m.failures.length, 0)} conditions)</summary>`);
    lines.push('');
    for (const m of failedModules) {
      lines.push(`**\`${m.module}\`**`);
      for (const f of m.failures) {
        lines.push(`- \`${f.src}\`: ${f.msg}`);
      }
      lines.push('');
    }
    lines.push('</details>');
    lines.push('');
  }
}

// Metadata
const meta = summaries[0]?.metadata;
if (meta) {
  const imageLines = Object.entries(meta.images || {})
    .filter(([, v]) => v)
    .map(([k, v]) => `\`${k}\`: \`${v}\``);
  if (imageLines.length > 0 || meta.targetRepo) {
    lines.push('<details>');
    lines.push('<summary>Test environment</summary>');
    lines.push('');
    if (meta.targetRepo) lines.push(`- **Target:** ${meta.targetRepo}${meta.targetPr ? ` #${meta.targetPr}` : ''}`);
    if (meta.actor) lines.push(`- **Triggered by:** [@${meta.actor}](https://github.com/${meta.actor})`);
    if (meta.sha) {
      const repo = meta.targetRepo || 'sirosfoundation/siros-conformance';
      lines.push(`- **Commit:** [\`${meta.sha.slice(0, 7)}\`](https://github.com/${repo}/commit/${meta.sha})${meta.ref ? ` (${meta.ref.replace('refs/heads/', '')})` : ''}`);
    }
    for (const il of imageLines) {
      lines.push(`- ${il}`);
    }
    lines.push('');
    lines.push('</details>');
    lines.push('');
  }
}

// Links
lines.push('**Links:**');
if (pagesUrl) {
  lines.push(`- [📊 Full Report (GitHub Pages)](${pagesUrl})`);
}
if (runUrl) {
  lines.push(`- [CI Run](${runUrl})`);
}
lines.push('');

// Footer
const timestamp = summaries[0]?.timestamp || new Date().toISOString();
lines.push(`---`);
lines.push(`*Generated ${timestamp} by [siros-conformance](https://github.com/sirosfoundation/siros-conformance)*`);

console.log(lines.join('\n'));
