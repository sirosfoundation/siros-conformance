# siros-conformance

OpenID Conformance Suite testing for SIROS ID — issuer, verifier, and wallet.

All services run from **pre-built Docker images** (`ghcr.io/sirosfoundation/*`).
No local source checkouts required.

## Prerequisites

```
# /etc/hosts (required by the conformance suite)
127.0.0.1 localhost.emobix.co.uk
```

```bash
make install   # npm ci + playwright chromium
```

## Quick start

```bash
# Issuer conformance
make up-issuer
make test-issuer

# Verifier conformance
make up-verifier
make test-verifier

# Wallet conformance (VCI + VP)
make up-wallet
make test-wallet

# Tear down
make down
```

## Profiles

| Profile | Compose files | Services |
|---------|--------------|----------|
| issuer | vc-services + go-trust + conformance-suite | vc-issuer, vc-apigw, vc-mockas, vc-registry, mongodb, go-trust-allow, conformance (3) |
| verifier | vc-services + go-trust + conformance-suite | vc-verifier, vc-registry, mongodb, go-trust-allow, conformance (3) |
| wallet | wallet + go-trust + vc-services + conformance-suite | wallet-frontend, wallet-backend, wallet-registry, go-trust-allow, vc-*, conformance (3) |

## Conformance reports

Each test exports an HTML report ZIP via `GET /api/plan/exporthtml/{planId}`.
Reports are saved to `conformance-results/` and uploaded as GitHub Actions artifacts (90-day retention).

## CI

Three separate GitHub Actions workflows run weekly (Monday 06:00 UTC),
on push to `main`, and via manual dispatch:

- `.github/workflows/issuer.yml`
- `.github/workflows/verifier.yml`
- `.github/workflows/wallet.yml`

The conformance suite image uses `:latest` — every CI run automatically
picks up the newest version.

## Directory structure

```
compose/                    # Docker Compose files (image-only, no builds)
configs/conformance/        # Conformance suite test plan configurations
fixtures/                   # VC service config, PKI, metadata, test users
helpers/                    # Playwright helper modules
specs/conformance/          # Test specs
.github/workflows/          # CI workflows
```
