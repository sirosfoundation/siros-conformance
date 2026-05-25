#!/usr/bin/env node
/**
 * Resolve golden release image tags from golden-releases.yaml.
 *
 * Reads the YAML file, selects the active release (or one specified via
 * --release <name>), and outputs shell export statements or env-file lines
 * that set Docker Compose image variables.
 *
 * Usage:
 *   eval "$(node scripts/resolve-golden-release.mjs)"
 *   eval "$(node scripts/resolve-golden-release.mjs --release beta_r2)"
 *   node scripts/resolve-golden-release.mjs --env-file >> $GITHUB_ENV
 *   node scripts/resolve-golden-release.mjs --json   # output as JSON
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const YAML_PATH = path.resolve(__dirname, '..', 'golden-releases.yaml');

// ── Minimal YAML parser (no dependencies) ──────────────────────────────────
// Handles the simple structure of golden-releases.yaml: scalars, maps, lists.

function parseSimpleYaml(text) {
  const result = {};
  const lines = text.split('\n');
  const stack = [{ indent: -1, obj: result }];

  for (const rawLine of lines) {
    const commentIdx = rawLine.indexOf('#');
    const line = commentIdx >= 0 ? rawLine.slice(0, commentIdx) : rawLine;
    if (line.trim() === '') continue;

    const indent = line.search(/\S/);
    const content = line.trim();

    // Pop stack to find parent
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }
    const parent = stack[stack.length - 1].obj;

    const colonIdx = content.indexOf(':');
    if (colonIdx === -1) continue;

    const key = content.slice(0, colonIdx).trim();
    const valuePart = content.slice(colonIdx + 1).trim();

    if (valuePart === '' || valuePart === '|' || valuePart === '>') {
      // Nested map
      const child = {};
      parent[key] = child;
      stack.push({ indent, obj: child });
    } else {
      // Scalar — strip quotes
      let val = valuePart;
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      parent[key] = val;
    }
  }

  return result;
}

// ── Service → env var mapping (matches parse-deps.mjs) ────────────────────

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

// ── Main ───────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const outputFormat = args.includes('--env-file') ? 'env-file'
  : args.includes('--json') ? 'json'
  : 'export';
const releaseIdx = args.indexOf('--release');
const requestedRelease = releaseIdx !== -1 ? args[releaseIdx + 1] : null;

if (!fs.existsSync(YAML_PATH)) {
  console.error(`Golden releases file not found: ${YAML_PATH}`);
  process.exit(1);
}

const yaml = parseSimpleYaml(fs.readFileSync(YAML_PATH, 'utf-8'));
const releaseName = requestedRelease || yaml.default;

if (!releaseName) {
  console.error('No release specified and no default set in golden-releases.yaml');
  process.exit(1);
}

const release = yaml.releases?.[releaseName];
if (!release) {
  const available = Object.keys(yaml.releases || {}).join(', ');
  console.error(`Release '${releaseName}' not found. Available: ${available}`);
  process.exit(1);
}

const images = release.images;
if (!images || Object.keys(images).length === 0) {
  console.error(`Release '${releaseName}' has no images defined`);
  process.exit(1);
}

if (outputFormat === 'json') {
  // Output as JSON map of service→full-image for use with parse-deps
  const result = {};
  for (const [service, tag] of Object.entries(images)) {
    const mapping = SERVICE_MAP[service];
    if (!mapping) {
      console.error(`Warning: unknown service '${service}' in release '${releaseName}'`);
      continue;
    }
    result[service] = `${mapping.image}:${tag}`;
  }
  console.log(JSON.stringify(result));
  process.exit(0);
}

const envVars = [];
for (const [service, tag] of Object.entries(images)) {
  const mapping = SERVICE_MAP[service];
  if (!mapping) {
    console.error(`Warning: unknown service '${service}' in release '${releaseName}'`);
    continue;
  }
  const fullImage = tag.includes('/') ? tag : `${mapping.image}:${tag}`;
  envVars.push({ name: mapping.env, value: fullImage, service });
}

if (envVars.length === 0) {
  process.exit(0);
}

console.error(`[golden-release] Using release '${releaseName}': ${release.description || ''}`);

for (const { name, value, service } of envVars) {
  if (outputFormat === 'env-file') {
    console.log(`${name}=${value}`);
  } else {
    console.log(`export ${name}=${value}`);
  }
}
