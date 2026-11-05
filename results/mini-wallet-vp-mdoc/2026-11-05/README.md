# Mini-wallet OID4VP mdoc conformance results — 2026-11-05

**The iso_mdl credential format green against the raw Rust engine.** The OID4VP
wallet plan's mdoc variant — `iso_mdl` / `x509_san_dns` / `direct_post` /
`request_uri_signed` / `plain_vp` — passed every applicable module:

| module | result |
|---|---|
| `oid4vp-1final-wallet-happy-flow` | PASSED |
| `oid4vp-1final-wallet-alternate-happy-flow` | PASSED |
| `oid4vp-1final-wallet-request-uri-method-post` | SKIPPED |
| `oid4vp-1final-wallet-fewer-claims-than-available` | PASSED |
| `oid4vp-1final-wallet-optional-credential-set` | PASSED |
| `oid4vp-1final-wallet-no-claims-in-dcql-query` | PASSED |
| `oid4vp-1final-wallet-negative-test-required-non-matching-credential` | PASSED |
| the other 8 negative tests | REVIEW |

**REVIEW is the negative modules' expected outcome**: the wallet correctly
refused each invalid request (each refusal reason verified in the flow
detail), and the suite's placeholder — the tester's screenshot evidence,
uploaded through `/api/log/{id}/images/{placeholder}` — completed them.

## What this run proves beyond the sd_jwt_vc runs

- **The mso_mdoc DCQL query** (OpenID4VP 1.0, B.4.1): the `[namespace,
  claim name]` paths select the mDL's `IssuerSignedItem`s by
  `org.iso.18013.5.1` namespace and identifier.
- **The DeviceResponse** (ISO/IEC 18013-5, 8.3.2.1.2.2): the selected items
  as issued, the `issuerAuth` COSE_Sign1 as issued, and the device key's
  ES256 signature over the session transcript of the request's
  `OpenID4VPHandover` (OpenID4VP 1.0, B.2.6.1) — `[null, null,
  ["OpenID4VPHandover", SHA-256(cbor([client_id, nonce, thumb|null,
  response_uri]))]]`.
- **The ISO 18013-5 document-signer profile** (B.1–B.3): the fixture DS
  certificate is ECDSA-SHA256-signed, carries the critical `1.0.18013.5.1.2`
  (mdlDS) EKU, ≤457-day validity, an issuer alternative name, and a CRL
  distribution point — a real CRL (AKI, CRL number, ≤90-day nextUpdate)
  served by the harness with the RFC 2585 §4.2 content type.

## The evidence

- `summary.json` — the machine-readable record: suite version (5.3.4), the
  plan ID, per-module results, the plan-detail link.
- `conformance-report-<plan>.zip` — the suite's exported HTML report.

## The wallet under test

`engine-adapter-wasm`'s mini-wallet page (`target/wasm-page`, built with
`make wasm-page` in the siros-wallet-core checkout): the wasm engine core in
the browser, the built-in conformance host holding the device key and both
held credentials — the SD-JWT PID and, since this run, the mDL — go-trust-allow
answering every trust evaluation. Driven by
`specs/conformance/mini-wallet-vp.spec.ts` (`make test-mini-wallet-vp` — all
four variants: the plain plan's two response modes, the HAIP plan, and the
mdoc variant).