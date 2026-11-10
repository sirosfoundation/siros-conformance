# Mini-wallet OID4VP dc_api conformance results — 2026-11-10

**The Digital Credentials API channel is complete** — all three module
groups of the haip plan's `dc_api.jwt` variant pass against the raw Rust
engine (53 modules total):

| group | modules | outcome |
|---|---|---|
| `x509_hash` / `request_uri_signed` | 19 | 11 PASSED, 8 REVIEW |
| `web-origin` / `request_uri_unsigned` | 14 | 10 PASSED, 4 REVIEW |
| `x509_hash` / `request_uri_multisigned` | 20 | 12 PASSED, 8 REVIEW |

REVIEW is the negative modules' expected outcome: the wallet refused each
invalid request for the right reason (the request-object signature, the
typ, the nonce, the origin binding, the client_id prefix, the
transaction-data type, the claim the credential does not carry), the
browser API's promise rejection posted to the module's submit URL, and
the tester's error-screen placeholder uploaded through the suite's API —
the certification procedure's manual step, automated.

## The new wire rules this run validated

- **The multi-signed request object** (RFC 7515 §7.2, the JWS JSON
  Serialization): every signature verifies through its
  compact-equivalent against the x5c in its own protected header; at
  least ONE valid signature authenticates the verifier (the
  `multisigned-one-invalid-signature` module invalidates the first and
  leaves the second valid on purpose — the wallet accepts, and the
  invalidated signature's client_id claim never authenticates anything).
  The client_id rides the signatures' protected headers, not the payload.
- **§5.9.2's bounds on the pre-registered fallback**: an unknown-prefixed
  client_id names a pre-registered client only on an UNSIGNED request
  (the alternate happy flow's `invalid_scheme:example`); a signed
  request's unknown prefix refuses (the invalid-prefix negative), and a
  value embedding a recognized prefix can never be pre-registered.
- **The web-origin form**: a request with no client_id — the caller's
  origin IS the client.
- **The origin binding** is enforced for an authenticated verifier (a
  recognized Client Identifier Prefix or a signed request object); the
  unsigned pre-registered fallback's `expected_origins` is advisory.

## The evidence

- `summary.json` — the machine-readable record, all three plan IDs
- `conformance-report-<plan>.zip` ×3 — the suite's exported HTML reports

The config fixture gained `client2` — the second verifier key and its
self-signed certificate (SAN DNS `conformance.example.com`) the
multisigned requests co-sign with; the fixture pki is archived under
`fixtures/mini-wallet-pki/`.

## Reproduce

```
# siros-wallet-core
cargo build -p engine-adapter-wasm --target wasm32-unknown-unknown
make wasm-page

# siros-conformance
WALLET_PAGE_DIR=<…>/siros-wallet-core/target/wasm-page make up-mini-wallet
npx playwright test specs/conformance/mini-wallet-vp-dcapi.spec.ts
```
