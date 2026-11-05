# Mini-wallet OID4VP HAIP conformance results — 2026-11-05

**The HAIP profile green against the raw Rust engine.** The OID4VP HAIP
wallet plan (`oid4vp-1final-wallet-haip-test-plan`) — `sd_jwt_vc` /
`eudi_pid` / `direct_post.jwt` — passed every applicable module:

| module | result |
|---|---|
| `oid4vp-1final-wallet-happy-flow` | PASSED |
| `oid4vp-1final-wallet-alternate-happy-flow` | PASSED |
| `oid4vp-1final-wallet-request-uri-method-post` | SKIPPED |
| `oid4vp-1final-wallet-ignores-unusable-encryption-key` | PASSED |
| `oid4vp-1final-wallet-all-mandatory-claims` | PASSED |
| `oid4vp-1final-wallet-fewer-claims-than-available` | PASSED |
| `oid4vp-1final-wallet-optional-credential-set` | PASSED |
| `oid4vp-1final-wallet-no-claims-in-dcql-query` | PASSED |
| `oid4vp-1final-wallet-pid-claims-path-array-index` | PASSED |
| `oid4vp-1final-wallet-pid-claims-path-array-all-elements` | PASSED |
| `oid4vp-1final-wallet-pid-claims-path-object-member` | PASSED |
| `oid4vp-1final-wallet-negative-test-required-non-matching-credential` | PASSED |
| the other 8 negative tests | REVIEW |

**REVIEW is the negative modules' expected outcome**: the wallet correctly
refused each invalid request (each refusal reason verified in the flow
detail — the bad request-object signature, the missing/wrong `typ`, the
mismatched client_id, the redirect_uri with direct_post, the missing
nonce, the invalid client_id prefix, the unknown transaction-data type,
the claim the credential does not carry), and the suite's placeholder —
the tester's screenshot evidence, uploaded through
`/api/log/{id}/images/{placeholder}` — completed them.

## What this run proves beyond the 2026-11-04 plain-plan runs

- **The `x509_hash` client_id scheme** (OpenID4VP 1.0 §5.2.3): the
  client_id is the base64url SHA-256 over the verifier's DER-encoded
  certificate; the engine requires the request object's `x5c` chain,
  verifies the JWS under the leaf, and checks the client_id's hash
  against it in constant time. An unsigned or chainless request under
  this scheme is refused.
- **The HAIP credential form** (HAIP-6.1.1): the wallet's PID carries its
  X.509 chain in the SD-JWT's JWS header (`x5c`, RFC 7515 §4.1.6), the
  chain validating to the profile's configured `credential.trust_anchor_pem`
  (fixtures/mini-wallet-pki) — the trust anchor itself never rides `x5c`.
- **The DCQL path forms over typed claims** (§7): array index
  (`["nationalities", 0]`), array all-elements, and object member
  (`["place_of_birth", "locality"]`) paths select the held PID's typed
  fixture claims (the EUDI PID 1.0 mandatory set, HAIP-6.2).

## The evidence

- `summary.json` — the machine-readable record: suite version (5.3.4),
  the plan ID, per-module results, the plan-detail link.
- `conformance-report-<plan>.zip` — the suite's exported HTML report.

## The wallet under test

`engine-adapter-wasm`'s mini-wallet page (`target/wasm-page`, built with
`make wasm-page` in the siros-wallet-core checkout): the wasm engine core
in the browser, the built-in conformance host holding the device key, the
registered client key, and the x5c-chained PID, go-trust-allow answering
every trust evaluation. Driven by
`specs/conformance/mini-wallet-vp.spec.ts` (`make test-mini-wallet-vp` —
all three variants: the plain plan's two response modes and the HAIP
plan).