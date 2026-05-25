#!/usr/bin/env node
/**
 * Parse conformance dependency overrides from various sources and output
 * shell export statements (or a .env file) for Docker Compose.
 *
 * Sources (checked in order of precedence):
 *   1. --json '{"vc-issuer":"pr-42", ...}'   (direct JSON input)
 *   2. --pr-body <file>                       (PR description file)
 *   3. --pr <owner/repo#number>               (fetch PR body via gh CLI)
 *
 * PR body syntax — a fenced block anywhere in the description:
 *
 *   ```conformance-deps
 *   vc-issuer: pr-42
 *   wallet-frontend: sha-abc123
 *   go-wallet-backend: ghcr.io/sirosfoundation/go-wallet-backend:feature-branch
 *   ```
 *
 * Short-form values are expanded:
 *   pr-42      → ghcr.io/sirosfoundation/<service>:pr-42
 *   sha-abc123 → ghcr.io/sirosfoundation/<service>:sha-abc123
 *   full-url   → used as-is
 *
 * Output (to stdout):
 *   export VC_ISSUER_IMAGE=ghcr.io/sirosfoundation/vc-issuer:pr-42
 *   export WALLET_FRONTEND_IMAGE=ghcr.io/sirosfoundation/wallet-frontend:sha-abc123
 *
 * Usage in CI:
 *   eval "$(node scripts/parse-deps.mjs --json '${{ inputs.image-overrides }}')"
 *   docker compose -f compose/vc-services.yml up -d
 */

import { execSync } from 'child_process';
import * as fs from 'fs';

// ── Service → env var / default image mapping ──────────────────────────────

const SERVICE_MAP = {
  'vc-registry':       { env: 'VC_REGISTRY_IMAGE',       image: 'ghcr.io/sirosfoundation/vc-registry' },
  'vc-issuer':         { env: 'VC_ISSUER_IMAGE',         image: 'ghcr.io/sirosfoundation/vc-issuer' },
  'vc-verifier':       { env: 'VC_VERIFIER_IMAGE',       image: 'ghcr.io/sirosfoundation/vc-verifier' },
  'vc-apigw':          { env: 'VC_APIGW_IMAGE',          image: 'ghcr.io/sirosfoundation/vc-apigw' },
  'vc-mockas':         { env: 'VC_MOCKAS_IMAGE',          image: 'ghcr.io/sirosfoundation/vc-mockas' },
  'go-trust':          { env: 'GO_TRUST_IMAGE',          image: 'ghcr.io/sirosfoundation/go-trust' },
  'wallet-frontend':   { env: 'WALLET_FRONTEND_IMAGE',   image: 'ghcr.io/sirosfoundation/wallet-frontend' },
  'go-wallet-backend': { env: 'WALLET_BACKEND_IMAGE',    image: 'ghcr.io/sirosfoundation/go-wallet-backend' },
};

// ── Parse arguments ────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const outputFormat = args.includes('--env-file') ? 'env-file' : 'export';
let overrides = {};

const jsonIdx = args.indexOf('--json');
const prBodyIdx = args.indexOf('--pr-body');
const prIdx = args.indexOf('--pr');

if (jsonIdx !== -1 && args[jsonIdx + 1]) {
  let raw = args[jsonIdx + 1].trim();
  // Handle double-encoded JSON from toJSON() in GitHub Actions
  // e.g. '"{}"' → '{}', '"{\\"key\\":\\"val\\"}"' → '{"key":"val"}'
  if (raw.startsWith('"') && raw.endsWith('"')) {
    try {
      const unwrapped = JSON.parse(raw);
      if (typeof unwrapped === 'string') raw = unwrapped;
    } catch (_) { /* not double-encoded, use as-is */ }
  }
  if (raw && raw !== '{}' && raw !== '') {
    try {
      overrides = JSON.parse(raw);
    } catch (e) {
      console.error(`Failed to parse --json: ${e.message}`);
      process.exit(1);
    }
  }
} else if (prBodyIdx !== -1 && args[prBodyIdx + 1]) {
  const body = fs.readFileSync(args[prBodyIdx + 1], 'utf-8');
  overrides = parsePrBody(body);
} else if (prIdx !== -1 && args[prIdx + 1]) {
  const prRef = args[prIdx + 1];
  const body = fetchPrBody(prRef);
  overrides = parsePrBody(body);
}

// ── Parse PR body for conformance-deps block ───────────────────────────────

function parsePrBody(body) {
  const result = {};
  // Match ```conformance-deps ... ``` blocks
  const pattern = /```conformance-deps\s*\n([\s\S]*?)```/g;
  let match;
  while ((match = pattern.exec(body)) !== null) {
    const block = match[1];
    for (const line of block.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const colonIdx = trimmed.indexOf(':');
      if (colonIdx === -1) continue;
      const key = trimmed.slice(0, colonIdx).trim();
      const value = trimmed.slice(colonIdx + 1).trim();
      if (key && value) {
        result[key] = value;
      }
    }
  }
  return result;
}

function fetchPrBody(prRef) {
  // prRef can be "owner/repo#123" or just "123" (uses current repo)
  let cmd;
  if (prRef.includes('#')) {
    const [repo, num] = prRef.split('#');
    cmd = `gh pr view ${num} --repo ${repo} --json body --jq .body`;
  } else {
    cmd = `gh pr view ${prRef} --json body --jq .body`;
  }
  try {
    return execSync(cmd, { encoding: 'utf-8', timeout: 15000 });
  } catch (e) {
    console.error(`Failed to fetch PR body: ${e.message}`);
    return '';
  }
}

// ── Resolve overrides to full image references ─────────────────────────────

const keys = Object.keys(overrides);
if (keys.length === 0) {
  // No overrides — silent exit
  process.exit(0);
}

const envVars = [];
for (const [service, value] of Object.entries(overrides)) {
  const mapping = SERVICE_MAP[service];
  if (!mapping) {
    console.error(`Warning: unknown service '${service}', skipping. Known: ${Object.keys(SERVICE_MAP).join(', ')}`);
    continue;
  }

  let fullImage;
  if (value.includes('/')) {
    // Full image reference (e.g. ghcr.io/sirosfoundation/vc-issuer:pr-42)
    fullImage = value;
  } else {
    // Short tag (e.g. pr-42, sha-abc123, feature-branch)
    fullImage = `${mapping.image}:${value}`;
  }

  envVars.push({ name: mapping.env, value: fullImage, service });
}

// ── Output ─────────────────────────────────────────────────────────────────

if (envVars.length > 0) {
  console.error(`Image overrides (${envVars.length}):`);
  for (const { name, value, service } of envVars) {
    console.error(`  ${service} → ${value}`);
    if (outputFormat === 'env-file') {
      console.log(`${name}=${value}`);
    } else {
      console.log(`export ${name}=${value}`);
    }
  }
}
