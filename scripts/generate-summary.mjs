#!/usr/bin/env node
/**
 * Generate a Markdown summary from conformance result JSON files.
 *
 * Reads *-summary.json files from the results directory and produces
 * a markdown comment suitable for posting on a GitHub PR.
 *
 * Usage:
 *   node scripts/generate-summary.mjs [results-dir] [--run-url URL]
 *
 * Output goes to stdout; pipe or redirect as needed.
 */

import * as fs from 'fs';
import * as path from 'path';

const resultsDir = process.argv[2] || './conformance-results';
const runUrlIdx = process.argv.indexOf('--run-url');
const runUrl = runUrlIdx !== -1 ? process.argv[runUrlIdx + 1] : process.env.GITHUB_RUN_URL || '';

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

function statusIcon(passed) {
  return passed ? '✅' : '❌';
}

function overallIcon(summary) {
  return summary.failed === 0 ? '✅' : '❌';
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

// Failure details
const failedSummaries = summaries.filter(s => s.failed > 0);
if (failedSummaries.length > 0) {
  lines.push('<details>');
  lines.push('<summary>Failed modules</summary>');
  lines.push('');

  for (const s of failedSummaries) {
    const label = PROFILE_LABELS[s.profile] || s.profile;
    const failedModules = s.modules.filter(m => !m.passed);
    lines.push(`### ${label}`);
    lines.push('');
    lines.push('| Module | Status | Result |');
    lines.push('|--------|--------|--------|');
    for (const m of failedModules) {
      lines.push(`| \`${m.module}\` | ${m.status} | ${m.result} |`);
    }
    lines.push('');
  }

  lines.push('</details>');
  lines.push('');
}

// Passed details (collapsed)
const passedSummaries = summaries.filter(s => s.passed > 0);
if (passedSummaries.length > 0) {
  lines.push('<details>');
  lines.push('<summary>Passed modules</summary>');
  lines.push('');

  for (const s of passedSummaries) {
    const label = PROFILE_LABELS[s.profile] || s.profile;
    const passedModules = s.modules.filter(m => m.passed);
    if (passedModules.length === 0) continue;
    lines.push(`### ${label}`);
    lines.push('');
    for (const m of passedModules) {
      lines.push(`- ✅ \`${m.module}\``);
    }
    lines.push('');
  }

  lines.push('</details>');
  lines.push('');
}

// Links
lines.push('**Links:**');
if (runUrl) {
  lines.push(`- [CI Run](${runUrl})`);
}
for (const s of summaries) {
  const label = PROFILE_LABELS[s.profile] || s.profile;
  if (s.planDetailUrl) {
    lines.push(`- [${label} — full report](${s.planDetailUrl})`);
  }
}
lines.push('');

// Footer
const timestamp = summaries[0]?.timestamp || new Date().toISOString();
lines.push(`---`);
lines.push(`*Generated ${timestamp} by [siros-conformance](https://github.com/sirosfoundation/siros-conformance)*`);

console.log(lines.join('\n'));
