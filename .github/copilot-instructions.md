# Copilot Instructions: siros-conformance

## Repository Purpose
This repo runs **OpenID Foundation Conformance Suite** tests against the SIROS ID wallet, issuer, and verifier. Tests are driven by **Playwright** which orchestrates the conformance suite REST API and automates the wallet browser UI.

## Architecture Overview

```
Playwright test runner
  ├── creates test plan via conformance suite REST API
  ├── starts each test module
  ├── when suite reaches WAITING state:
  │   ├── VCI: extracts credential offer URL, navigates wallet to accept
  │   └── VP: extracts authorization request URL, navigates wallet to present
  └── collects results + exports HTML report
```

### Key Services (Docker Compose)
| Service | Default Port | Purpose |
|---------|-------------|---------|
| conformance-suite | 8443 (HTTPS) | OpenID Foundation test suite |
| wallet-frontend | 3000 | SIROS wallet SPA |
| wallet-backend (go-wallet-backend) | 8080-8082 | Wallet backend + admin API |
| vc-issuer | 9000 | OpenID4VCI credential issuer |
| vc-verifier | 9001 | OpenID4VP verifier |
| vc-apigw | 9003 | OAuth Authorization Server |
| vc-registry | 9004 | Status list registry |
| go-trust | 7443 | Trust list / anchor service |

### Hostnames
The conformance suite requires `localhost.emobix.co.uk` to resolve to `127.0.0.1`. This is needed in `/etc/hosts`.

## File Layout

```
specs/conformance/
  oid4vci-wallet.spec.ts   # VCI wallet tests (credential issuance)
  oid4vp-wallet.spec.ts    # VP wallet tests (credential presentation)
  oid4vci-issuer.spec.ts   # Issuer tests (suite acts as wallet)
  oid4vp-verifier.spec.ts  # Verifier tests (suite acts as wallet)

configs/conformance/
  vci-wallet-config.json        # sd_jwt_vc VCI config
  vci-wallet-mdoc-config.json   # mdoc VCI config
  vp-wallet-config.json         # sd_jwt_vc VP config
  vp-wallet-mdoc-config.json    # iso_mdl VP config
  vci-issuer-config.json        # Issuer profile config
  vp-verifier-config.json       # Verifier profile config

helpers/
  conformance-api.ts        # REST client for conformance suite API
  wallet-automation.ts      # Wallet UI automation (offer acceptance, etc.)
  ui-actions.ts             # Login/registration WebAuthn flows
  shared-helpers.ts         # ENV config, tenant CRUD, test ID generation
  vc-services.ts            # vc-issuer/verifier/apigw API helpers
  webauthn.ts               # CDP WebAuthn virtual authenticator
  tenant-setup-fixture.ts   # Playwright fixture: creates tenant + registers user

compose/
  conformance-suite.yml     # Conformance suite + MongoDB + nginx
  wallet.yml                # Wallet frontend + backend
  vc-services.yml           # vc-issuer, vc-verifier, vc-apigw, vc-registry
  go-trust.yml              # Trust anchor service
```

## Conformance Suite REST API

Base URL: `https://localhost.emobix.co.uk:8443/`

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `api/runner/available` | GET | List available test modules |
| `api/plan/available` | GET | List available test plans |
| `api/plan` | POST | Create test plan (params: `planName`, `variant`; body: config JSON) |
| `api/runner?test=X&plan=Y` | POST | Create test module from plan |
| `api/runner/{moduleId}` | POST | Start a test module |
| `api/info/{moduleId}` | GET | Get module status/result |
| `api/log/{moduleId}` | GET | Get detailed test log entries |
| `api/plan/exporthtml/{planId}` | GET | Export HTML report as ZIP |

### Module States
`CREATED` → `CONFIGURED` → `WAITING` → `RUNNING` → `FINISHED`
Also: `INTERRUPTED` (error state)

### Result Values
`PASSED`, `WARNING`, `FAILED`, `REVIEW`, `SKIPPED`

## Variant System

Each spec file defines a `*_VARIANTS` array. Each variant has:
- `name`: human-readable label
- `variant`: dimension key-value pairs sent to the conformance suite
- `configPath` (optional): relative path to a config JSON (defaults to the spec's base config)

### VCI Variant Dimensions (11 keys)
`credential_format`, `vci_grant_type`, `vci_credential_issuance_mode`, `vci_credential_offer_variant`, `sender_constrain`, `vci_credential_encryption`, `fapi_profile`, `fapi_request_method`, `client_auth_type`, `authorization_request_type`, `vci_authorization_code_flow_variant`

### VP Variant Dimensions (5 keys)
`credential_format`, `client_id_prefix`, `response_mode`, `request_method`, `vp_profile`

## Debugging Test Failures

### 1. Check which module failed
Look at the Playwright output for lines like:
```
Module oid4vci-wallet-happy-flow result: FAILED
  Conditions: INFO=12 SUCCESS=8 FAILURE=2
  FAILURE [CheckCredentialFormat]: Expected sd_jwt_vc but got mdoc
```

### 2. Get detailed conformance log
The conformance API log (`api/log/{moduleId}`) contains structured entries:
- Each entry has `src` (condition name), `msg` (message), `result` (condition result)
- Entries with `result: 'FAILURE'` are the actual failures
- Entries with `startBlock: true` mark the beginning of a test phase

To inspect manually:
```bash
curl -k https://localhost.emobix.co.uk:8443/api/log/{moduleId} | jq '.[] | select(.result == "FAILURE")'
```

### 3. Common failure patterns

**"No interaction URL found"** → The conformance suite didn't expose a credential offer or authorization request. Check:
- Is the config `alias` correct? The offer URL is built from it.
- Is the `client_id` in the config registered with the wallet backend?
- Check `api/log/{moduleId}` for the actual URLs the suite generated.

**"Module did not finish in time"** → The wallet didn't complete the flow. Check:
- Playwright screenshots in `test-results/` directory
- Was the wallet able to log in? (tenant setup may have failed)
- Is the credential offer URL scheme correct? (`openid-credential-offer://` for VCI, `openid4vp://` for VP)

**"FAILURE [CheckTokenEndpointResponse]"** → Token exchange failed. Check:
- DPoP key binding issues
- `client_auth_type` mismatch between variant and config
- Client key (`private_key`) in config must match what the wallet sends

**"FAILURE [ValidateCredential*]"** → Credential validation failed. Check:
- Credential format mismatch (sd_jwt_vc vs mdoc)
- Signing key issues (the config's `credential_signing_alg` must match)
- For mdoc: doctype and namespace must match what the suite expects

**"FAILURE [CheckAuthorizationResponse]"** → VP response rejected. Check:
- `response_mode` mismatch (direct_post vs direct_post.jwt)
- VP token format doesn't match `credential_format` variant
- For iso_mdl: mso_mdoc format issues, CBOR encoding, doctype mismatch

**Tenant setup failures** → Check `tenant-setup-fixture.ts`:
- Admin API at `http://localhost:8081` must be reachable
- WebAuthn registration flow via CDP virtual authenticator
- PRF extension mock injection (`webauthn.ts`)

### 4. Inspect the conformance suite UI
Open `https://localhost.emobix.co.uk:8443/` in a browser:
- Plan detail: `plan-detail.html?plan={planId}`
- Module log: `log-detail.html?log={moduleId}`
These show the same info as the API but with formatted HTML.

### 5. Config debugging
Configs are JSON files with keys:
- `alias`: unique name for this test run (appears in URLs)
- `description`: human-readable label
- `client.client_id`: must match wallet registration
- `client.private_key` / `client.jwks`: client authentication key material
- `server.jwks`: server signing keys (for conformance suite as issuer/verifier)
- For VP: `server.authorization_endpoint` must be the wallet's scheme (`openid4vp://`)
- For VP: `resource.dcql_query` or `resource.presentation_definition` defines what credentials to request

### 6. Docker / service debugging
```bash
# Check all services are up
docker compose -f compose/wallet.yml -f compose/vc-services.yml -f compose/go-trust.yml -f compose/conformance-suite.yml ps

# Check conformance suite logs
docker compose -f compose/conformance-suite.yml logs -f conformance-suite

# Check wallet backend logs
docker compose -f compose/wallet.yml logs -f wallet-backend

# Restart a specific service
docker compose -f compose/wallet.yml restart wallet-frontend
```

### 7. Running a single failing module
```bash
# Run only one variant
npx playwright test specs/conformance/oid4vci-wallet.spec.ts --grep "mdoc"

# With headed browser for visual debugging
npx playwright test specs/conformance/oid4vci-wallet.spec.ts --grep "mdoc" --headed

# With trace recording
npx playwright test specs/conformance/oid4vci-wallet.spec.ts --grep "mdoc" --trace on
```

## Environment Variables
| Variable | Default | Purpose |
|----------|---------|---------|
| `CONFORMANCE_URL` | `https://localhost.emobix.co.uk:8443/` | Conformance suite base URL |
| `CONFORMANCE_TOKEN` | (none) | API auth token (dev mode doesn't need one) |
| `FRONTEND_URL` | `http://localhost:3000` | Wallet frontend URL |
| `BACKEND_URL` | `http://localhost:8080` | Wallet backend URL |
| `ADMIN_URL` | `http://localhost:8081` | Wallet admin API URL |
| `ADMIN_TOKEN` | `e2e-test-admin-token-for-testing-purposes-only` | Admin API token |
| `NODE_TLS_REJECT_UNAUTHORIZED` | (must be `0`) | Required for self-signed conformance suite cert |
| `GITHUB_ACTOR`, `GITHUB_SHA` | (CI only) | Injected into config for traceability |
