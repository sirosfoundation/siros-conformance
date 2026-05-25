#!/usr/bin/env node
/**
 * Parse a @conformance comment and output JSON for repository_dispatch.
 *
 * Comment syntax:
 *   @conformance                              → run all profiles, :latest images
 *   @conformance issuer                       → run issuer profile only
 *   @conformance wallet                       → run wallet profile only
 *   @conformance wallet/mdoc                  → wallet profile, only mdoc variants
 *   @conformance wallet/haip                  → wallet profile, only haip variants
 *   @conformance vc-issuer:pr-42              → auto-detect profile, override image
 *   @conformance issuer vc-issuer:pr-42       → explicit profile + override
 *   @conformance wallet/mdoc wallet-frontend:pr-111 → variant filter + override
 *   @conformance wallet-frontend:pr-111 go-wallet-backend:sha-abc123
 *   @conformance ghcr.io/other/image:tag      → full image ref
 *
 * Image name shortcuts (bare names without registry prefix):
 *   vc-issuer, vc-verifier, vc-apigw, vc-registry, vc-mockas,
 *   go-trust, wallet-frontend, wallet-backend, go-wallet-backend,
 *   wallet-registry, go-wallet-registry
 *
 * Output (JSON to stdout):
 *   {
 *     "profiles": ["issuer"],
 *     "image-overrides": {"vc-issuer": "pr-42"},
 *     "variant-filter": "",
 *     "dispatch-events": ["conformance-issuer"]
 *   }
 *
 * Usage:
 *   echo "@conformance vc-issuer:pr-42" | node scripts/parse-comment.mjs
 *   node scripts/parse-comment.mjs --comment "@conformance wallet vc-issuer:pr-42"
 *   node scripts/parse-comment.mjs --body-file /tmp/comment.txt
 */

import * as fs from 'fs';

// ── Known services ─────────────────────────────────────────────────────────

const SERVICE_NAMES = new Set([
  'vc-registry', 'vc-issuer', 'vc-verifier', 'vc-apigw', 'vc-mockas',
  'go-trust',
  'wallet-frontend', 'wallet-backend', 'go-wallet-backend',
  'wallet-registry', 'go-wallet-registry',
]);

// Service → which profile(s) it belongs to
const SERVICE_PROFILES = {
  'vc-issuer':         ['issuer'],
  'vc-apigw':          ['issuer'],
  'vc-mockas':         ['issuer'],
  'vc-verifier':       ['verifier'],
  'vc-registry':       ['issuer', 'verifier', 'wallet'],
  'go-trust':          ['issuer', 'verifier', 'wallet'],
  'wallet-frontend':   ['wallet'],
  'wallet-backend':    ['wallet'],
  'go-wallet-backend': ['wallet'],
  'wallet-registry':   ['wallet'],
  'go-wallet-registry':['wallet'],
};

const VALID_PROFILES = new Set(['issuer', 'verifier', 'wallet', 'all']);

const PROFILE_TO_EVENT = {
  'issuer':   'conformance-issuer',
  'verifier': 'conformance-verifier',
  'wallet':   'conformance-wallet',
};

// ── Read input ─────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
let commentText = '';

const commentIdx = args.indexOf('--comment');
const bodyFileIdx = args.indexOf('--body-file');

if (commentIdx !== -1 && args[commentIdx + 1]) {
  commentText = args[commentIdx + 1];
} else if (bodyFileIdx !== -1 && args[bodyFileIdx + 1]) {
  commentText = fs.readFileSync(args[bodyFileIdx + 1], 'utf-8');
} else {
  // Read from stdin
  commentText = fs.readFileSync(0, 'utf-8');
}

// ── Find the @conformance line ─────────────────────────────────────────────

// Match @conformance followed by optional tokens on the same line(s)
// Support multi-line: @conformance on first line, overrides on subsequent lines
const match = commentText.match(/@conformance\b([\s\S]*?)(?:\n\n|$)/i);
if (!match) {
  console.error('No @conformance directive found in comment');
  process.exit(1);
}

const payload = match[1].trim();
const tokens = payload.split(/\s+/).filter(Boolean);

// ── Parse tokens ───────────────────────────────────────────────────────────

const explicitProfiles = [];
const imageOverrides = {};
let variantFilter = '';

for (const token of tokens) {
  // Check if it's a profile/variant pair (e.g. wallet/mdoc)
  const slashIdx = token.indexOf('/');
  if (slashIdx !== -1 && !token.slice(0, slashIdx).includes('.') && !token.slice(0, slashIdx).includes(':')) {
    const profilePart = token.slice(0, slashIdx).toLowerCase();
    const variantPart = token.slice(slashIdx + 1);
    if (VALID_PROFILES.has(profilePart) && variantPart) {
      explicitProfiles.push(profilePart);
      variantFilter = variantPart;
      continue;
    }
  }

  // Check if it's a profile name
  if (VALID_PROFILES.has(token.toLowerCase())) {
    explicitProfiles.push(token.toLowerCase());
    continue;
  }

  // Check if it's an image:tag pair
  const colonIdx = token.lastIndexOf(':');
  if (colonIdx === -1) {
    console.error(`Warning: unrecognized token '${token}', skipping`);
    continue;
  }

  const imagePart = token.slice(0, colonIdx);
  const tagPart = token.slice(colonIdx + 1);

  if (!tagPart) {
    console.error(`Warning: empty tag in '${token}', skipping`);
    continue;
  }

  // Is it a full image ref (contains /) or a bare service name?
  if (imagePart.includes('/')) {
    // Full image reference — need to figure out which service it maps to
    // Extract the last path component as the service name guess
    const lastPart = imagePart.split('/').pop();
    if (SERVICE_NAMES.has(lastPart)) {
      imageOverrides[lastPart] = `${imagePart}:${tagPart}`;
    } else {
      // Can't resolve — store the full thing under the last path component
      // The user provided a fully qualified image, pass it through
      imageOverrides[lastPart] = `${imagePart}:${tagPart}`;
    }
  } else if (SERVICE_NAMES.has(imagePart)) {
    // Bare service name — short tag
    imageOverrides[imagePart] = tagPart;
  } else {
    console.error(`Warning: unknown service '${imagePart}' in '${token}', skipping. Known: ${[...SERVICE_NAMES].join(', ')}`);
  }
}

// ── Determine profiles ─────────────────────────────────────────────────────

let profiles;

if (explicitProfiles.includes('all') || (explicitProfiles.length === 0 && Object.keys(imageOverrides).length === 0)) {
  // "all" or bare @conformance → run everything
  profiles = ['issuer', 'verifier', 'wallet'];
} else if (explicitProfiles.length > 0) {
  profiles = [...new Set(explicitProfiles)];
} else {
  // Auto-detect from overridden services
  const detectedProfiles = new Set();
  for (const service of Object.keys(imageOverrides)) {
    const profs = SERVICE_PROFILES[service];
    if (profs) {
      for (const p of profs) detectedProfiles.add(p);
    }
  }
  profiles = detectedProfiles.size > 0 ? [...detectedProfiles] : ['issuer', 'verifier', 'wallet'];
}

// ── Output ─────────────────────────────────────────────────────────────────

const result = {
  profiles,
  'image-overrides': imageOverrides,
  'variant-filter': variantFilter,
  'dispatch-events': profiles.map(p => PROFILE_TO_EVENT[p]),
};

console.log(JSON.stringify(result));
