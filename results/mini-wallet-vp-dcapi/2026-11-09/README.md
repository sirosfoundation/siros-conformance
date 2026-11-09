# Mini-wallet OID4VP dc_api conformance results — 2026-11-09

**The Digital Credentials API channel is green** — the last piece of the
OIDF OID4VP wallet plan family. The haip plan's `x509_hash` /
`request_uri_signed` / `dc_api.jwt` module group (19 modules, `eudi_pid`
on the HAIP profile) passes against the raw Rust engine:

- **11 PASSED** — both happy flows, the unusable-encryption-key,
  all-mandatory-claims, fewer-claims, optional-credential-set,
  no-claims, the three DCQL path forms, and the
  required-non-matching-credential negative (the `access_denied`
  answering through the browser channel)
- **8 REVIEW** — the negative modules' expected outcome: the wallet
  refuses each invalid request for the right reason (the request-object
  signature, the typ, the nonce, the origin binding, the client_id
  scheme, the transaction-data type, the claim the credential does not
  carry), the browser API's promise rejection posts to the module's
  submit URL, and the tester's error-screen placeholder uploads through
  the suite's API.

## The channel (OpenID4VP 1.0 §8.4)

The request arrives by value inside the browser API's
`{digital: {requests: [...]}}` payload. The wallet never POSTs its
answer back: the engine's flow completes with the DigitalCredential's
data — the plain response object for `dc_api`, the JWE for
`dc_api.jwt` — and the host hands it to the browser. The engine checks
the caller's actual origin against the request's `expected_origins`
(the wrong-expected-origins negative), binds the KB-JWT's `aud` to it
(`origin:` + the URL, HAIP-7.3.2), and uses the
OpenID4VPDCAPIHandover for mdoc presentations (B.2.6.2). The harness
plays the browser's role: the engine's `wmp.flow.complete`
notification (forwarded through the adapter's new outgoing transport)
carries the response data, and the spec hands it to the module's
browser API submit URL exactly as the suite's own page does.

## The evidence

- `summary.json` — the machine-readable record
- `conformance-report-t8zTXhIGHDy25.zip` — the suite's exported HTML report

## Reproduce

```
# siros-wallet-core
cargo build -p engine-adapter-wasm --target wasm32-unknown-unknown
make wasm-page

# siros-conformance
WALLET_PAGE_DIR=<…>/siros-wallet-core/target/wasm-page make up-mini-wallet
npx playwright test specs/conformance/mini-wallet-vp-dcapi.spec.ts
```

With this, every module group of every agreed OIDF plan passes through
the mini-wallet: OID4VCI (both grants, both issuance modes), OID4VP
(both redirect response modes, the HAIP profile, the iso_mdl format,
and now the Digital Credentials API channel).
