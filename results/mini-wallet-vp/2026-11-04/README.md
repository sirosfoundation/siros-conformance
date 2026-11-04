# Mini-wallet OID4VP conformance results — 2026-11-04

**Phase 2 green: the OIDF OID4VP wallet plan passes against the raw Rust
engine.** Both response-mode variants of the agreed plan — `sd_jwt_vc` /
`x509_san_dns` / `request_uri_signed` / `plain_vp`, `direct_post` and
`direct_post.jwt` — passed every applicable module:

| module | direct_post | direct_post.jwt |
|---|---|---|
| `oid4vp-1final-wallet-happy-flow` | PASSED | PASSED |
| `oid4vp-1final-wallet-alternate-happy-flow` | PASSED | PASSED |
| `oid4vp-1final-wallet-ignores-unusable-encryption-key` | — | PASSED |
| `oid4vp-1final-wallet-fewer-claims-than-available` | PASSED | PASSED |
| `oid4vp-1final-wallet-optional-credential-set` | PASSED | PASSED |
| `oid4vp-1final-wallet-no-claims-in-dcql-query` | PASSED | PASSED |
| `oid4vp-1final-wallet-negative-test-required-non-matching-credential` | PASSED | PASSED |
| `oid4vp-1final-wallet-request-uri-method-post` | SKIPPED | SKIPPED |
| the other 8 negative tests | REVIEW | REVIEW |

**REVIEW is the negative modules' expected outcome**: the wallet correctly
refused each invalid request (each refusal reason verified in the flow
detail — the bad request-object signature, the missing/wrong `typ`, the
mismatched client_id, the redirect_uri with direct_post, the missing
nonce, the unrecognized client_id prefix, the unknown transaction-data
type, the claim the credential does not carry), and the suite's
placeholder — the tester's screenshot evidence, uploaded through
`/api/log/{id}/images/{placeholder}` — completed them. The certification
procedure's manual step, automated.

`request-uri-method-post` is skipped by the suite — the agreed variant
does not exercise the POST request_uri method.

## The evidence

- `summary.json` — the machine-readable record: suite version (5.3.4),
  the two plan IDs, per-module results, the plan-detail links.
- `conformance-report-<plan>.zip` — the suite's exported HTML reports.

## The wallet under test

The raw engine (`siros-wallet-core`) driven by the mini-wallet harness
page. The mini host holds a self-issued PID SD-JWT (RFC 9901,
holder-bound to its generated device key) and builds the SD-JWT+KB
presentations through `siros-sdjwt` — the engine's OID4VP protocol
(request parsing, the request-object rules, the DCQL contract, the
response modes, the §8.2 redirect) is the thing under test, judged by
its HTTP traffic alone.

## Remaining for the full OID4VP plan

- The **haip** profile: needs the `x509_hash` client_id scheme (and the
  `dc_api` browser-API request variants) — the plan
  `oid4vp-1final-wallet-haip-test-plan` accepts no variant the engine
  can answer today.
- The **iso_mdl** format: the mdoc presentation path (DeviceResponse
  over the session transcript) in the mini host.

## Reproduce

```
# siros-wallet-core
cargo build -p engine-adapter-wasm --target wasm32-unknown-unknown
make wasm-page

# siros-conformance
WALLET_PAGE_DIR=<…>/siros-wallet-core/target/wasm-page make up-mini-wallet
npx playwright test specs/conformance/mini-wallet-vp.spec.ts
```

`specs/debug/mini-page-vp-debug.spec.ts` drives one module with full
capture (`VP_MODULE`, `VP_RESPONSE_MODE`, `VP_PROFILE` select it).
