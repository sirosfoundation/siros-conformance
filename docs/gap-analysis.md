# Conformance Suite — Gap Analysis & Roadmap

> Last updated: 2026-05-24

## Current State

We run **4 test plans** with **1 variant each**:

| Plan | Variant | Modules |
|------|---------|---------|
| `oid4vci-1_0-wallet-test-plan` | `sd_jwt_vc / pre_authorization_code / immediate / by_value` | 4 wallet |
| `oid4vp-1final-wallet-test-plan` | `sd_jwt_vc / x509_san_dns / direct_post / request_uri_signed / plain_vp` | 15 wallet |
| `oid4vci-1_0-issuer-test-plan` | `sd_jwt_vc / pre_authorization_code / immediate` | ~20 issuer |
| `oid4vp-1final-verifier-test-plan` | `sd_jwt_vc / x509_san_dns / direct_post / request_uri_signed` | ~11 verifier |

The suite supports **12 test plans** for OID4VCI/OID4VP with dozens of variant
combinations per plan. We exercise a small fraction of the available test
surface.

---

## Priority Tiers

### P0 — Same config, just add a variant entry

These require no wallet feature work and no new config files. Just add an entry
to `VCI_VARIANTS` / `VP_VARIANTS` in the spec file.

#### VCI Wallet

| Variant | Change | Why |
|---------|--------|-----|
| `authorization_code` grant | `vci_grant_type: 'authorization_code'` | Most VCI deployments use auth-code flow. We only test pre-auth. |
| `by_reference` offer | `vci_credential_offer_variant: 'by_reference'` | Credential offers via reference URL — common in cross-device flows. |
| `deferred` issuance | `vci_credential_issuance_mode: 'deferred'` | Issuer returns a transaction_id; wallet polls. We support this already. |

#### VP Wallet

| Variant | Change | Why |
|---------|--------|-----|
| `direct_post.jwt` response | `response_mode: 'direct_post.jwt'` | Encrypted/signed VP response — required for HAIP. |
| `haip` profile | `vp_profile: 'haip'` | EU ARF/HAIP compliance. Tests stricter requirements. |
| `redirect_uri` client_id | `client_id_prefix: 'redirect_uri'` | Simplest trust model, no certificates needed. |

### P1 — Needs config or infrastructure changes

#### Client Attestation (VCI)

| Variant | Change | Blocker |
|---------|--------|---------|
| `client_attestation` auth | `client_auth_type: 'client_attestation'` | Needs attestation keypair and WIA (Wallet Instance Attestation) setup |

**Status:** Research exists in `security/` repo on key attestation flows.
The wallet backend already has WIA support via the `/wallet-instance-attestation`
endpoint. Main work is:
1. Generate a client attestation signing key for the conformance config
2. Configure the conformance suite to accept our WIA format
3. Ensure the wallet sends the attestation PoP in the token request

See: `security/attestation/` for existing key attestation research.

#### Digital Credentials API (VP)

| Variant | Change | Blocker |
|---------|--------|---------|
| `dc_api` response mode | `response_mode: 'dc_api'` | Needs browser Digital Credentials API support in test browser |
| `dc_api.jwt` response mode | `response_mode: 'dc_api.jwt'` | Same — requires Chromium with DC API flags |

**Status:** The DC API (`navigator.credentials.get()` with `digital` type) is
only available in Chrome Canary/Dev behind flags. Playwright supports Chromium
channel selection. Work needed:
1. Add Playwright config for Chrome Canary channel
2. Handle the DC API credential picker UI in the test
3. May need `--enable-features=WebIdentityDigitalCredentials` launch flag

#### RAR Authorization Requests (VCI)

| Variant | Change | Blocker |
|---------|--------|---------|
| `rar` authorization | `authorization_request_type: 'rar'` | Wallet must send Rich Authorization Requests |

**Status:** RAR (RFC 9396) is supported by the wallet backend's authorization
flow. Needs verification that the conformance suite's mock AS accepts our
RAR format.

### P2 — Needs wallet feature work (mdoc/mDL)

We already support mdoc credentials to a large extent. The remaining work is
primarily conformance-specific configuration.

#### mdoc VCI (Credential Issuance)

| Variant | Change | Wallet work |
|---------|--------|-------------|
| `mdoc` credential format | `credential_format: 'mdoc'` | Config: mdoc-specific credential offer handling |

**What we have:** The wallet already handles `mso_mdoc` format credentials via
the `wallet-common` CBOR/mdoc parser. The VCI flow for mdoc differs from
SD-JWT in:
- Credential request uses `format: "mso_mdoc"` with `doctype` instead of `vct`
- Response contains CBOR-encoded mdoc instead of SD-JWT string
- Proof of possession uses the same JWT proof mechanism

**Config needed:**
- New config file `configs/conformance/vci-wallet-mdoc-config.json` with:
  - `credential.doctype`: `org.iso.18013.5.1.mDL` (or PID equivalent)
  - `credential.namespace`: `org.iso.18013.5.1`
  - Signing key with x5c chain (existing keys should work)
- Variant entry with `credential_format: 'mdoc'`

#### iso_mdl VP (Credential Presentation)

| Variant | Change | Wallet work |
|---------|--------|-------------|
| `iso_mdl` credential format | `credential_format: 'iso_mdl'` | Config: mdoc presentation in VP response |

**What we have:** The wallet can present mdoc credentials via OID4VP. The
conformance suite test flow:
1. Suite sends authorization request with `dcql_query` or `presentation_definition`
   requesting an mdoc credential
2. Wallet selects the mdoc credential and creates a `DeviceResponse`
3. Suite verifies the `DeviceResponse` structure and `DeviceAuth`

**Config needed:**
- New config file `configs/conformance/vp-wallet-mdoc-config.json` with:
  - `server.authorization_endpoint`: `mdoc-openid4vp://` (different scheme for mdoc)
  - mdoc-specific DCQL query in `client.dcql`
  - Both signing key (`use: sig`, with x5c) and encryption key (`use: enc`)
- Pre-loaded mdoc credential in the wallet for the test
- Variant entry with `credential_format: 'iso_mdl'`

#### HAIP Test Plans

| Plan | What it tests |
|------|--------------|
| `oid4vci-1_0-wallet-haip-test-plan` | HAIP-constrained VCI (limited variants) |
| `oid4vp-1final-wallet-haip-test-plan` | HAIP-constrained VP (only `direct_post.jwt` / `dc_api.jwt`) |

**Status:** The HAIP plans use a reduced variant space that matches the EU
Digital Identity Wallet Architecture Reference Framework (ARF). Once we pass
the base `sd_jwt_vc` + `direct_post.jwt` variant, the HAIP plans should be
straightforward additions (they use the same modules with stricter variant
constraints).

#### VP ID3 with DCQL

| Plan | What it tests |
|------|--------------|
| `oid4vp-id3-wallet-test-plan` | Draft spec with DCQL query language support |

**Status:** DCQL (Digital Credentials Query Language) replaces Presentation
Exchange as the recommended query format. The wallet-common library has partial
DCQL support. The ID3 plan adds a `query_language` dimension:
`presentation_exchange` vs `dcql`.

---

## Unused API Features

| Feature | Method | Opportunity |
|---------|--------|-------------|
| Plan discovery | `api/plan/available` | Dynamically discover available plans instead of hardcoding plan names |
| Module discovery | `api/runner/available` | List modules with their variant dimensions at runtime |
| Per-module variants | `createTestFromPlanWithVariant()` | Override variant for individual modules within a plan |
| Explicit start | `startTest()` | Start tests explicitly rather than auto-start on creation |

### Recommended: Runtime Plan Discovery

Add an `api/plan/available` wrapper to `conformance-api.ts` and use it to
validate plan names and variant values before creating a test plan. This would
catch misconfigured variants early instead of failing at runtime.

---

## Infrastructure Gaps

### 1. No variant selection in CI

The workflow dispatch (`wallet.yml`) has no way to select which variants to run.
All variants in the `VCI_VARIANTS` / `VP_VARIANTS` arrays run unconditionally.

**Fix:** Add a `variants` workflow input that filters which named variants to
execute. Default to `all`.

### 2. No variant-level result tracking

The summary JSON records the variant name but there's no cross-run comparison
or regression detection per variant.

**Fix:** Track per-variant pass/fail history in the gh-pages data. Flag
regressions in the summary comment.

### 3. Static config files

Each variant combination that needs different keys or endpoints requires a
separate JSON config file. This doesn't scale.

**Fix:** Use config templates with a builder that composes the right config
from variant parameters. The `loadConfig()` functions in the spec files
already do some substitution — extend this pattern.

### 4. No test module filtering

We always run all modules in a plan. For debugging, it would be useful to
run a single module.

**Fix:** Add a `--grep` or module filter to the test runner, and a
`module` workflow dispatch input.

---

## Variant Naming Convention

Target syntax for PR-triggered conformance runs:

```
@conformance <profile>/<variant-preset>
```

Examples:
```
@conformance vci-wallet/default          # Current sd_jwt_vc / pre-auth / immediate
@conformance vci-wallet/authcode         # authorization_code grant
@conformance vci-wallet/mdoc-preauth     # mdoc format, pre-auth
@conformance vp-wallet/default           # Current sd_jwt_vc / x509 / direct_post
@conformance vp-wallet/haip             # HAIP profile
@conformance vp-wallet/mdoc             # iso_mdl format
@conformance vci-wallet/all             # Run all defined variants
```

Variant presets would be defined in a `variants.json` or as named entries in
the spec files' `VCI_VARIANTS` / `VP_VARIANTS` arrays.
