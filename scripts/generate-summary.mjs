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

const CONDITION_ORDER = ['SUCCESS', 'FAILURE', 'WARNING', 'REVIEW', 'INFO'];

function overallIcon(summary) {
  return summary.failed === 0 ? '✅' : '❌';
}

function formatConditions(counts) {
  if (!counts || Object.keys(counts).length === 0) return '—';
  return CONDITION_ORDER
    .filter(k => counts[k])
    .map(k => {
      const icon = k === 'SUCCESS' ? '🟢' : k === 'FAILURE' ? '🔴' : k === 'WARNING' ? '🟡' : '⚪';
      return `${icon} ${k} ${counts[k]}`;
    })
    .join(' · ');
}

// ── Build markdown ─────────────────────────────────────────────────────────

const lines = [];

// Header
const totalPassed = summaries.reduce((s, r) => s + r.passed, 0);
const totalFailed = summaries.reduce((s, r) => s + r.failed, 0);
const totalModules = summaries.reduce((s, r) => s + r.total, 0);
const allPassed = totalFailed === 0;

lines.push(`## ${allPassed ? '✅' : '❌'} Conformance Results`);
lines.push('');

// Overview table
lines.push('| Profile | Passed | Failed | Total | Result |');
lines.push('|---------|-------:|-------:|------:|--------|');
for (const s of summaries) {
  const label = PROFILE_LABELS[s.profile] || s.profile;
  lines.push(`| ${label} | ${s.passed} | ${s.failed} | ${s.total} | ${overallIcon(s)} |`);
}
lines.push(`| **Total** | **${totalPassed}** | **${totalFailed}** | **${totalModules}** | ${allPassed ? '✅' : '❌'} |`);
lines.push('');

// Per-profile detail with conditions
for (const s of summaries) {
  const label = PROFILE_LABELS[s.profile] || s.profile;
  lines.push(`### ${label}`);
  lines.push('');
  lines.push('| Module | Result | Conditions |');
  lines.push('|--------|--------|------------|');
  for (const m of s.modules) {
    const icon = m.passed ? '✅' : '❌';
    const conds = formatConditions(m.conditions);
    lines.push(`| \`${m.module}\` | ${icon} ${m.result} | ${conds} |`);
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
