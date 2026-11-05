# Mini-wallet OID4VCI conformance results — 2026-11-05

**The authorization-code grant green against the raw Rust engine.** Both
issuance modes of the agreed OID4VCI wallet plan variant — `sd_jwt_vc` /
`authorization_code` (issuer-initiated) / `by_value` / DPoP sender-constrain /
`private_key_jwt` client auth / plain credential encryption — passed every
applicable module, in both the immediate and the deferred issuance mode:

| module | immediate | deferred |
|---|---|---|
| `oid4vci-1_0-wallet-test-credential-issuance` | PASSED | PASSED |
| `oid4vci-1_0-wallet-test-credential-issuance-notification` | PASSED | PASSED |
| `oid4vci-1_0-wallet-happy-path-with-scopes-without-authorization-details-in-token-response` | PASSED | PASSED |
| `oid4vci-1_0-wallet-test-batch-credential-issuance` | SKIPPED | SKIPPED |

`batch-credential-issuance` is skipped by the suite — the agreed variant does
not exercise batch issuance.

## What this run proves beyond the 2026-11-04 runs

The authorization-code grant spans **two WMP calls and a page reload**: the
flow start pushes the authorization request to PAR (RFC 9126) and hands the
authorization URL to the user agent; the AS returns the code to the wallet's
redirect_uri; the reloaded page answers the open flow with it. Both halves are
the raw engine's:

- **PAR client authentication (RFC 7523 at RFC 9126 §2.1)**: the AS's
  `token_endpoint_auth_methods_supported` names `private_key_jwt`, so the
  pushed request carries the client assertion — engine-built, host-signed with
  the registered kid, a fresh single-use `jti` per attempt.
- **The stateless resume**: the authorization stash (the PKCE verifier, the
  CSRF state, the offer params) rides the engine's KeyValue port, which the
  wasm adapter persists through the page's `kv` callbacks (localStorage) —
  the reloaded engine resolves the flow family from the KV registry and the
  stash from the KV store.
- **The code-for-token exchange**: the RFC 7523 assertion at the token
  endpoint (the same builder, the same registered kid), the stashed PKCE
  verifier, the RFC 8707 resource, and the DPoP binding — then the
  issuance tail exactly as the pre-authorized grant's (proofs, deferred
  polling, notification).

## The evidence

- `summary.json` — the machine-readable record: suite version (5.3.4), the
  two plan IDs, per-module results, the plan-detail links.
- `conformance-report-<plan>.zip` — the suite's exported HTML reports.

## The wallet under test

`engine-adapter-wasm`'s mini-wallet page (`target/wasm-page`, built with
`make wasm-page` in the siros-wallet-core checkout at engine commit
`033c5eb`): the wasm engine core in the browser, the built-in conformance
host holding the device key and the registered client key, go-trust-allow
answering every trust evaluation. Driven by
`specs/conformance/mini-wallet.spec.ts` (`make test-mini-wallet` — all four
variants: both grants, both issuance modes).