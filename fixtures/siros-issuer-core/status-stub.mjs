#!/usr/bin/env node
// LOCAL-TEST-ONLY status-list stub for the siros-issuer-core conformance
// profile.
//
// Exists ONLY because the deployed test siros-status-service mints
// StatusListTokens whose embedded `jwk` header carries no `kid`, which the
// OIDF suite's AbstractVerifyJwsSignature rejects — see
// https://github.com/sirosfoundation/siros-status-service/issues/20.
// This stub mirrors the deployed service's allocate/update/fetch contract
// but signs StatusListTokens with the kid embedded, per RFC 7515 §4.1.4.
//
// Delete this file (and its compose service) when the upstream fix ships
// and the test deployment is redeployed. Never deploy it anywhere real:
// its AS is fail-open and its state is in-memory.

import { createServer } from 'node:http';
import { deflateSync } from 'node:zlib';
import { SignJWT, importJWK, generateKeyPair, exportJWK } from 'jose';

const BIND = process.env.STATUS_BIND || '0.0.0.0:8080';
const BASE_URL = process.env.STATUS_BASE_URL || 'http://siros-issuer-core-status:8080';
const LIST_CAPACITY = 100000;

const { publicKey, privateKey } = await generateKeyPair('ES256', { extractable: true });
const jwk = await exportJWK(publicKey);
jwk.kty = 'EC';
jwk.crv = 'P-256';
jwk.alg = 'ES256';
jwk.use = 'sig';
jwk.kid = 'stub-status-key-1';

const lists = new Map(); // list_id -> { bits, bytes: Uint8Array }
let currentListId = null;

function listUrl(id) {
  return `${BASE_URL}/lists/${id}`;
}

function mintStatusListToken(id) {
  const list = lists.get(id);
  const lst = deflateSync(Buffer.from(list.bytes)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    sub: listUrl(id),
    iat: now,
    ttl: 3600,
    status_list: { bits: list.bits, lst },
  })
    .setProtectedHeader({ alg: 'ES256', typ: 'statuslist+jwt', kid: jwk.kid, jwk })
    .sign(privateKey);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // AS token endpoint: fail-open (trust any client assertion) — local-test
  // only, mirroring the deployed test AS's AllowAllEvaluator mode.
  if (req.method === 'POST' && url.pathname === '/token') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ access_token: 'stub-access-token', token_type: 'Bearer', expires_in: 3600 }));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/allocate') {
    // Herd privacy (RFC 9180 / the suite's
    // VCIWarnBatchStatusListUrisProvideHerdPrivacy): allocations share
    // ONE current list — a batch of credentials gets the same list URI
    // with distinct indices, instead of one list per credential (a
    // unique URI per credential correlates them). Indices are RANDOM
    // (the suite's VCIEnsureBatchStatusListIndicesAreUnpredictable: a
    // constant-stride sequence lets an observer infer credentials were
    // issued together; the deployed service allocates randomly too) —
    // occupied slots are tracked in `used`, a new list is minted when
    // the current one fills.
    if (!lists.has(currentListId)) {
      currentListId = `stub.${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
      lists.set(currentListId, { bits: 2, bytes: new Uint8Array(LIST_CAPACITY * 2 / 8), used: new Set() });
    }
    const list = lists.get(currentListId);
    if (list.used.size >= LIST_CAPACITY) {
      currentListId = null;
      res.writeHead(503, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'status list full' }));
      return;
    }
    let index;
    do {
      index = Math.floor(Math.random() * LIST_CAPACITY);
    } while (list.used.has(index));
    list.used.add(index);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ list_url: listUrl(currentListId), index, exp: null }));
    return;
  }

  const statusMatch = url.pathname.match(/^\/status\/([^/]+)\/(\d+)$/);
  if (req.method === 'PATCH' && statusMatch) {
    const [, id, idxStr] = statusMatch;
    const list = lists.get(id);
    if (!list) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'list not found' }));
      return;
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
    const value = { VALID: 0, INVALID: 1, SUSPENDED: 2, RESUME: 0 }[String(body.status ?? '').toUpperCase()];
    if (value === undefined) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'unknown status' }));
      return;
    }
    const idx = Number(idxStr);
    const byte = Math.floor((idx * list.bits) / 8);
    const offset = (idx * list.bits) % 8;
    list.bytes[byte] = (list.bytes[byte] & ~(0b11 << offset)) | (value << offset);
    res.writeHead(200);
    res.end();
    return;
  }

  const listMatch = url.pathname.match(/^\/lists\/([^/]+)$/);
  if (req.method === 'GET' && listMatch) {
    const [, id] = listMatch;
    if (!lists.has(id)) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'list not found' }));
      return;
    }
    const token = await mintStatusListToken(id);
    res.writeHead(200, {
      'content-type': 'application/statuslist+jwt',
      'cache-control': 'no-store',
    });
    res.end(token);
    return;
  }

  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
});

const bindIdx = BIND.lastIndexOf(':');
const BIND_HOST = BIND.slice(0, bindIdx);
const BIND_PORT = Number(BIND.slice(bindIdx + 1));

server.listen(BIND_PORT, BIND_HOST, () => {
  console.log(`status stub on ${BIND} (${BASE_URL})`);
});