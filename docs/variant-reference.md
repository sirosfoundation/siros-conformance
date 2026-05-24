# Conformance Suite — Variant Reference

> Generated from a live query of the OpenID Conformance Suite API
> (`api/plan/available`, `api/runner/available`) on 2026-05-24.
> Suite image: `registry.gitlab.com/openid/conformance-suite:latest`

This document lists every test plan relevant to SIROS and the full set of
variant dimensions the suite exposes for each.

---

## Test Plans Overview

### Wallet Test Plans (suite acts as issuer/verifier, we are the wallet)

| Plan name | Display name | Status |
|-----------|-------------|--------|
| `oid4vci-1_0-wallet-test-plan` | OID4VCI 1.0 Final: Test a wallet | **Active** |
| `oid4vci-1_0-wallet-haip-test-plan` | OID4VCI 1.0 Final/HAIP: Test a wallet | Available |
| `oid4vp-1final-wallet-test-plan` | OID4VP 1.0 Final: Test a wallet | **Active** |
| `oid4vp-1final-wallet-haip-test-plan` | OID4VP 1.0 Final/HAIP: Test a wallet | Available |
| `oid4vp-id3-wallet-test-plan` | OID4VP ID3 (+ draft 24): Test a wallet | Available |
| `oid4vp-id2-wallet-test-plan` | OID4VP ID2: Test a wallet | Legacy |

### Issuer/Verifier Test Plans (suite acts as wallet/RP, tests our services)

| Plan name | Display name | Status |
|-----------|-------------|--------|
| `oid4vci-1_0-issuer-test-plan` | OID4VCI 1.0 Final: Test an issuer | **Active** |
| `oid4vci-1_0-issuer-haip-test-plan` | OID4VCI 1.0 Final/HAIP: Test an issuer | Available |
| `oid4vp-1final-verifier-test-plan` | OID4VP 1.0 Final: Test a verifier | **Active** |
| `oid4vp-1final-verifier-haip-test-plan` | OID4VP 1.0 Final/HAIP: Test a verifier | Available |
| `oid4vp-id3-verifier-test-plan` | OID4VP ID3 (+ draft 24): Test a verifier | Available |
| `oid4vp-id2-verifier-test-plan` | OID4VP ID2: Test a verifier | Legacy |

---

## VCI Wallet Variants

**Plan:** `oid4vci-1_0-wallet-test-plan` (24 modules)

| Dimension | API key | Values |
|-----------|---------|--------|
| Credential Format | `credential_format` | `sd_jwt_vc`, `mdoc` |
| Grant Type | `vci_grant_type` | `pre_authorization_code`, `authorization_code` |
| Issuance Mode | `vci_credential_issuance_mode` | `immediate`, `deferred` |
| Offer Variant | `vci_credential_offer_variant` | `by_value`, `by_reference` |
| Sender Constraining | `sender_constrain` | `dpop`, `mtls` |
| Credential Encryption | `vci_credential_encryption` | `plain`, `encrypted` |
| FAPI Profile | `fapi_profile` | `vci`, `vci_haip`, `plain_fapi`, `openbanking_uk`, `consumerdataright_au`, `openbanking_brazil`, `connectid_au`, `cbuae`, `fapi_client_credentials_grant` |
| Request Method | `fapi_request_method` | `unsigned`, `signed_non_repudiation` |
| Client Auth Type | `client_auth_type` | `private_key_jwt`, `mtls`, `client_attestation` |
| Authorization Request | `authorization_request_type` | `simple`, `rar` |
| Auth Code Flow Variant | `vci_authorization_code_flow_variant` | `issuer_initiated`, `wallet_initiated`, `issuer_initiated_dc_api` |

### VCI Wallet Modules (24)

```
oid4vci-1_0-wallet-happy-path-with-scopes-without-authorization-details-in-token-response
oid4vci-1_0-wallet-test-client-attestation-challenge
oid4vci-1_0-wallet-test-credential-issuance
oid4vci-1_0-wallet-test-credential-issuance-notification
```

Plus 20 issuer-side modules that run within the same plan for completeness.

---

## VCI Wallet HAIP Variants

**Plan:** `oid4vci-1_0-wallet-haip-test-plan`

Reduced variant space targeting the HAIP/ARF profile:

| Dimension | API key | Values |
|-----------|---------|--------|
| Auth Code Flow Variant | `vci_authorization_code_flow_variant` | `wallet_initiated`, `issuer_initiated` |
| Credential Format | `credential_format` | `sd_jwt_vc`, `mdoc` |
| Offer Variant | `vci_credential_offer_variant` | `by_value`, `by_reference` |

---

## VP Wallet Variants

**Plan:** `oid4vp-1final-wallet-test-plan` (26 modules, 15 wallet-side)

| Dimension | API key | Values |
|-----------|---------|--------|
| Credential Format | `credential_format` | `sd_jwt_vc`, `iso_mdl` |
| Client ID Prefix | `client_id_prefix` | `x509_san_dns`, `redirect_uri`, `pre_registered`, `decentralized_identifier`, `web-origin`, `x509_hash` |
| Response Mode | `response_mode` | `direct_post`, `direct_post.jwt`, `dc_api`, `dc_api.jwt` |
| Request Method | `request_method` | `request_uri_signed`, `url_query`, `request_uri_unsigned`, `request_uri_multisigned` |
| VP Profile | `vp_profile` | `plain_vp`, `haip` |

### VP Wallet Modules (15 wallet-side)

```
oid4vp-1final-wallet-alternate-happy-flow
oid4vp-1final-wallet-fewer-claims-than-available
oid4vp-1final-wallet-happy-flow
oid4vp-1final-wallet-multisigned-one-invalid-signature
oid4vp-1final-wallet-negative-test-invalid-client-id-prefix
oid4vp-1final-wallet-negative-test-invalid-request-object-signature
oid4vp-1final-wallet-negative-test-mismatched-client-id
oid4vp-1final-wallet-negative-test-missing-nonce
oid4vp-1final-wallet-negative-test-redirect-uri-with-direct-post
oid4vp-1final-wallet-negative-test-response-uri-not-client-id
oid4vp-1final-wallet-negative-test-unknown-transaction-data-type
oid4vp-1final-wallet-negative-test-wrong-expected-origins
oid4vp-1final-wallet-no-claims-in-dcql-query
oid4vp-1final-wallet-optional-credential-set
oid4vp-1final-wallet-request-uri-method-post
```

---

## VP Wallet HAIP Variants

**Plan:** `oid4vp-1final-wallet-haip-test-plan`

Minimal variant space for HAIP/ARF:

| Dimension | API key | Values |
|-----------|---------|--------|
| Credential Format | `credential_format` | `sd_jwt_vc`, `iso_mdl` |
| Response Mode | `response_mode` | `direct_post.jwt`, `dc_api.jwt` |

---

## VP Wallet ID3 Variants

**Plan:** `oid4vp-id3-wallet-test-plan` (5 modules)

| Dimension | API key | Values |
|-----------|---------|--------|
| Credential Format | `credential_format` | `sd_jwt_vc`, `iso_mdl` |
| Client ID Scheme | `client_id_scheme` | `did`, `pre_registered`, `redirect_uri`, `web-origin`, `x509_san_dns` |
| Query Language | `query_language` | `presentation_exchange`, `dcql` |
| Request Method | `request_method` | `request_uri_unsigned`, `request_uri_signed` |
| Response Mode | `response_mode` | `direct_post`, `direct_post.jwt`, `dc_api`, `dc_api.jwt` |

---

## VCI Issuer Variants

**Plan:** `oid4vci-1_0-issuer-test-plan`

| Dimension | API key | Values |
|-----------|---------|--------|
| Client Auth Type | `client_auth_type` | `private_key_jwt`, `mtls`, `client_attestation` |
| Sender Constraining | `sender_constrain` | `mtls`, `dpop` |
| Credential Format | `credential_format` | `sd_jwt_vc`, `mdoc` |
| Auth Code Flow Variant | `vci_authorization_code_flow_variant` | `wallet_initiated`, `issuer_initiated` |
| Authorization Request | `authorization_request_type` | `simple`, `rar` |
| OpenID | `openid` | `plain_oauth`, `openid_connect` |
| Request Method | `fapi_request_method` | `unsigned`, `signed_non_repudiation` |
| Grant Type | `vci_grant_type` | `authorization_code`, `pre_authorization_code` |
| Credential Encryption | `vci_credential_encryption` | `plain`, `encrypted` |
| FAPI Profile | `fapi_profile` | `vci`, `vci_haip`, `plain_fapi`, ... |
| FAPI Response Mode | `fapi_response_mode` | `plain_response`, `jarm` |

---

## VP Verifier Variants

**Plan:** `oid4vp-1final-verifier-test-plan`

| Dimension | API key | Values |
|-----------|---------|--------|
| Credential Format | `credential_format` | `sd_jwt_vc`, `iso_mdl` |
| Client ID Prefix | `client_id_prefix` | `redirect_uri`, `x509_san_dns`, `x509_hash` |
| Request Method | `request_method` | `url_query`, `request_uri_signed` |
| VP Profile | `vp_profile` | `plain_vp`, `haip` |
| Response Mode | `response_mode` | `direct_post`, `direct_post.jwt` |

---

## Conformance Suite API Endpoints

| Endpoint | Method | Description | Used? |
|----------|--------|-------------|-------|
| `/api/runner/available` | GET | List all test modules with variant info | Via `getAllTestModules()` — **unused** |
| `/api/plan/available` | GET | List all test plans with variant info | Not wrapped in API client |
| `/api/plan` | POST | Create a test plan | ✅ `createTestPlan()` |
| `/api/plan` | GET | List existing plans (paginated) | Not used |
| `/api/runner` | POST | Create a test module from a plan | ✅ `createTestFromPlan()` |
| `/api/runner` | POST | Create with per-module variant | Via `createTestFromPlanWithVariant()` — **unused** |
| `/api/runner/{id}` | POST | Explicitly start a test | Via `startTest()` — **unused** |
| `/api/info/{id}` | GET | Get module status | ✅ `getModuleInfo()` |
| `/api/log/{id}` | GET | Get test log | ✅ `getTestLog()` |
| `/api/plan/exporthtml/{id}` | GET | Export plan results as ZIP | ✅ `exportPlanResults()` |
