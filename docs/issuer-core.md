# siros-issuer-core conformance

Run the OpenID Foundation OID4VCI issuer suite against `siros-issuer-core`
(the Rust issuer), the same way `oid4vci-issuer.spec.ts` runs it against the
Go vc-issuer.

## Run

```sh
docker build --network=host -t siros-issuer-core:local ../siros-issuer-core
make up-issuer-core
make test-issuer-core
```

Use `SIROS_ISSUER_CORE_IMAGE` to test another image. Reports and the module
summary land in `conformance-results/`.

## Variants

`specs/conformance/oid4vci-issuer-core.spec.ts` runs four variants —
`credential_format` × grant type:

| variant | credential | suite scope |
| --- | --- | --- |
| `sd_jwt_vc` pre-authorized / wallet-initiated | `urn:eudi:pid:1` (dc+sd-jwt) | `pid` |
| `mdoc` pre-authorized / wallet-initiated | `eu.europa.ec.eudi.pid.1` (mso_mdoc) | `pid_mdoc` |

The suite config (`configs/conformance/vci-issuer-core-config.json`) carries
`${CREDENTIAL_CONFIGURATION_ID}`, `${CLIENT_SCOPE}` and
`${KEY_ATTESTATION_JWKS}` placeholders the runner substitutes per variant;
the issuer's `[authorization.scopes]` maps `pid`/`pid_mdoc` to the matching
configuration (the suite's wallet sends scope-based PAR with no
`authorization_details`). The mdoc variants need two more fixtures:

- `fixtures/siros-issuer-core/signing-cert.pem` (self-signed over the
  signing key), mounted at `/etc/siros-issuer/signing-cert.pem` and
  configured as `signing.cert_chain_path` — the mdoc `IssuerSigned` x5chain.
- `fixtures/siros-issuer-core/attestation-issuer.jwk` — the suite's
  key-attestation issuer key (private, with `x5c` + `x5t#S256`; the suite's
  `AbstractSignJWT` refuses to build attestation headers without them),
  spliced into the config's `vci.key_attestation_jwks`. The issuer verifies
  the resulting proof's self-consistency against that x5c leaf
  (`verify_attestation_proof`).

## ZK fixtures (design §8.3)

The issuer's conformance fixture carries the ZK layer:

- `fixtures/siros-issuer-core/zkcircuits/circuits.json` (mounted at
  `/etc/siros-issuer/zkcircuits`, `[zk.circuits] static_dir`) — the circuit
  catalog: vega-mc (publishes `saltBytes: "32"` for the nym_auth doctype) +
  longfellow (publishes no salt param).
- `[zk.rulebooks.nym_auth]` in `fixtures/siros-issuer-core/config.toml` —
  rulebook #1: governs `eu.europa.ec.eudi.nym_auth.1`, binds `vega-mc`, and
  carries the to_wallet auxiliary-data plan (HKDF over issuing_country +
  personal_administrative_number → the ssc commitment at
  `[doctype, ssc]`). LOCAL TEST ONLY: the HKDF seed is in-line config.
- The nym_auth doctype in the fixture TS11 catalog (documents.json +
  schema-page.json) — the metadata advertises it, but no suite scope maps
  to it (the suite never requests it), so it exercises nothing in the
  OIDF run; it exists so the fixture matches the issuer's testdata.

The mdoc credential configuration advertises `proof_types_supported:
{attestation: {proof_signing_alg_values_supported: [ES256]}}` (from the
catalog), which makes the suite's wallet select the attestation proof type:
its attestation JWT carries `typ: key-attestation+jwt`, `x5c`/`x5t#S256`,
and claims `iat`/`exp`/`attested_keys`/`nonce` — **no `aud`** (the issuer
checks aud only when present, and pins the alg to ES256 as advertised).

Two more mdoc requirements the suite enforces (both fixture-level —
issuance is catalog-driven, so these are data, not code):

- **The document-signer certificate must name a CRL distribution point**
  (ISO 18013-5 Table B.3; the suite's `FetchMdocDsCertificateCrl` fetches
  and parses it). `signing-cert.pem` is a CA-signed leaf (validity ≤
  457 days, critical EKU `1.3.6.1.5.5.7.3.36` id-kp-documentSigning,
  non-critical basicConstraints, SKI/AKI, issuerAltName contact) carrying
  `crlDistributionPoints = URI:https://issuer.conformance.example.com:9443/crl/ca.crl`
  (+ the CA); `ca.crl` (DER, CA-signed, empty, **with an authority key
  identifier** per the ISO 18013-5 CRL profile, nextUpdate ≤ 90 days) is
  served by nginx at that URI.
- **The issued PID must carry the EUDI PID Rulebook mandatory elements**
  (`EnsureMdocPidMandatoryDataElementsPresent`): family_name, given_name,
  birth_date, place_of_birth (a `{country, region, locality}` map),
  nationality (an alpha-2 array), issuing_authority, issuing_country. The
  fixture catalogs and subjects carry all seven.

And one issuance-level typing the suite's value checks demand:
**`birth_date` is an RFC 8943 full-date** — CBOR tag 1004 over the
`YYYY-MM-DD` text (ISO 18013-5 element typing; vc's `mdoc.FullDate`
marshals the same tag). `MsoBuilder::add_full_date` emits it.

The mso_mdoc configuration carries **no `claims` member** in the issuer
metadata: the suite's `credential_issuer_metadata-1_0.json` mso_mdoc
branch defines only `doctype` and
`credential_signing_alg_values_supported` (`unevaluatedProperties:false` —
a claims member warns as an unknown extension), unlike the dc+sd-jwt
branch which carries claims. The catalog's claims still drive issuance
(schema gate, elements) — just not the metadata.

The DS certificate follows the ISO 18013-5 profile the suite checks:
validity ≤ 457 days, `keyUsage: digitalSignature` critical, EKU critical
`1.3.6.1.5.5.7.3.36` (id-kp-documentSigning), basicConstraints present
but **not** critical, `issuerAltName` with contact information, SKI/AKI,
and the CRL distribution point; the CRL itself carries an authority key
identifier and nextUpdate ≤ 90 days.

## P2 scope — COMPLETE: the OIDF suite passes fully

**13/14 modules PASSED, 1 SKIPPED, 0 FAILED — all four variants**
(sd_jwt_vc and mso_mdoc × pre-authorized/issuer-initiated and
authorization-code/wallet-initiated, dpop, plain encryption). The one
skip is profile scope: key attestations not configured.

The two formerly-skipped modules now PASS: the `-signed` metadata test
(the issuer-core x5c work made the signed metadata verifiable) and the
batch endpoint (advertised and issued). Verified both locally and on
the issuer-core repo's CI workflow (run 43451126802, 2026-11-13) —
the CI conformance pipeline is WIRED AND GREEN: the workflow builds
the issuer image, brings up this compose stack, drives the OIDF suite
through the issuer spec, exports the certification ZIPs + run
summaries as artifacts, and (on release tags) uploads them to the
release for the conformance.siros.org pull publish.

One spec fix the CI wiring forced (commit b6f2239): the pre-auth offer
delivery loop keys on the module's per-client
"Waiting for call to credential offer endpoint" log markers, never on
a sampled state — the state stays WAITING through each client's
processing, so a fast module invites over-delivery (observed on CI:
offer #3 landed on a FINISHED module and the illegal state change
flipped multiple-clients to FAILED).

Both OID4VCI grants are implemented (design doc §7):

- `pre-authorized_code` — the suite acts as the wallet redeeming a
  pre-authorized offer.
- `authorization_code` — PAR → `GET /authorize` → **Mode A login handoff**
  (§7.2): the suite's browser lands on the dev portal
  (`fixtures/siros-issuer-core/portal.mjs`), which authenticates a test user,
  completes the authorization server-to-server, and redirects back with the
  code. PKCE S256 is enforced at `/token`.
- `sender_constrain: dpop` — DPoP (RFC 9449) proofs are validated at `/token`
  (binding) and `/credential` (fresh proof + `ath` + matching `jkt`).

## Adapter boundaries

- `compose/siros-issuer-core.yml` starts the core, the dev portal, and
  go-trust (allow mode). The conformance suite comes from
  `conformance-suite.yml` on the same network.
- `fixtures/siros-issuer-core/config.toml` is local-test-only configuration.
  `issuer.url` is the TLS proxy's hostname (nginx terminates TLS; the suite's
  Java truststore carries the conformance CA); `allow_insecure_url` covers the
  plain-HTTP compose-internal calls (go-trust, the dev portal, the status
  stub). TLS is terminated upstream in real deployments.
- `fixtures/siros-issuer-core/signing.jwk` is the issuer's SD-JWT signing
  key fixture; `signing-cert.pem` (over the same key) is the mdoc x5chain;
  `integrator.jwk` is the dev portal's client-assertion key.
- The dev portal is the design's "integrating application" for conformance
  runs: it accepts any username and must never be deployed anywhere real.
- The core's catalog comes from `fixtures/siros-issuer-core/ts11/`
  (static fixture mode — the same fixture catalog as the repo's own tests).