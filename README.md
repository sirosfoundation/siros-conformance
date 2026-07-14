# siros-conformance

[OpenID Conformance Suite](https://www.certification.openid.net/) testing for SIROS ID — issuer, verifier, and wallet.

All services run from **pre-built Docker images** (`ghcr.io/sirosfoundation/*`).
No local source checkouts required.

## Prerequisites

- Docker and Docker Compose
- Node.js 20+
- An `/etc/hosts` entry:

```
127.0.0.1 localhost.emobix.co.uk
```

Then install dependencies:

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

| Profile | Services |
|---------|----------|
| `issuer` | vc-issuer, vc-apigw, vc-mockas, vc-registry, mongodb, go-trust-allow, conformance suite |
| `verifier` | vc-verifier, vc-registry, mongodb, go-trust-allow, conformance suite |
| `wallet` | wallet-frontend, go-wallet-backend (with registry), go-trust-allow, vc-*, conformance suite |

## Filtering by variant

Each test plan runs multiple **variants** — combinations of credential format,
grant type, response mode, etc. Use Playwright's `--grep` to run a subset:

```bash
# Only mdoc variants
npx playwright test specs/conformance/oid4vci-wallet.spec.ts --grep "mdoc"

# Only HAIP variants
npx playwright test specs/conformance/oid4vp-wallet.spec.ts --grep "haip"

# Only authorization_code grant
npx playwright test specs/conformance/oid4vci-wallet.spec.ts --grep "authorization_code"

# Only deferred issuance
npx playwright test specs/conformance/oid4vci-wallet.spec.ts --grep "deferred"

# Combine filters (regex)
npx playwright test specs/conformance/oid4vci-wallet.spec.ts --grep "mdoc.*deferred"
```

### Useful quick-test filters

| Goal | Filter | Variants matched |
|------|--------|-----------------|
| Core VCI flow | `--grep "pre-authorized_code.*immediate.*by_value"` | 1 of 5 |
| Core VP flow | `--grep "x509_san_dns.*direct_post/.*plain_vp"` | 1 of 5 |
| All sd_jwt_vc | `--grep "sd_jwt_vc"` | 4 VCI + 4 VP |
| All mdoc/iso_mdl | `--grep "mdoc\|iso_mdl"` | 1 VCI + 1 VP |
| HAIP only | `--grep "haip"` | 1 VP |

### Current variants

**VCI Wallet** (`oid4vci-wallet.spec.ts`):
- `sd_jwt_vc/pre-authorized_code/immediate/by_value`
- `sd_jwt_vc/authorization_code/immediate/by_value`
- `sd_jwt_vc/pre-authorized_code/immediate/by_reference`
- `sd_jwt_vc/pre-authorized_code/deferred/by_value`
- `mdoc/pre-authorized_code/immediate/by_value`

**VP Wallet** (`oid4vp-wallet.spec.ts`):
- `sd_jwt_vc/x509_san_dns/direct_post/request_uri_signed/plain_vp`
- `sd_jwt_vc/x509_san_dns/direct_post.jwt/request_uri_signed/plain_vp`
- `sd_jwt_vc/x509_san_dns/direct_post/request_uri_signed/haip`
- `sd_jwt_vc/redirect_uri/direct_post/request_uri_signed/plain_vp`
- `iso_mdl/x509_san_dns/direct_post/request_uri_signed/plain_vp`

**Issuer** (`oid4vci-issuer.spec.ts`): 1 variant — `sd_jwt_vc/pre-authorized_code/immediate`

**Verifier** (`oid4vp-verifier.spec.ts`): 1 variant — `sd_jwt_vc/x509_san_dns/direct_post/request_uri_signed`

## Image overrides

All Docker images default to `:latest` but can be overridden to test
images built from a PR branch.

| Service name | Env var | Default image |
|-------------|---------|---------------|
| `vc-issuer` | `VC_ISSUER_IMAGE` | `ghcr.io/sirosfoundation/vc/issuer:latest` |
| `vc-verifier` | `VC_VERIFIER_IMAGE` | `ghcr.io/sirosfoundation/vc/verifier:latest` |
| `vc-apigw` | `VC_APIGW_IMAGE` | `ghcr.io/sirosfoundation/vc/apigw:latest` |
| `vc-registry` | `VC_REGISTRY_IMAGE` | `ghcr.io/sirosfoundation/vc/registry:latest` |
| `vc-mockas` | `VC_MOCKAS_IMAGE` | `ghcr.io/sirosfoundation/vc/mockas:latest` |
| `go-trust` | `GO_TRUST_IMAGE` | `ghcr.io/sirosfoundation/go-trust:latest` |
| `wallet-frontend` | `WALLET_FRONTEND_IMAGE` | `ghcr.io/sirosfoundation/wallet-frontend:latest` |
| `go-wallet-backend` | `WALLET_BACKEND_IMAGE` | `ghcr.io/sirosfoundation/go-wallet-backend:latest` |

```bash
VC_ISSUER_IMAGE=ghcr.io/sirosfoundation/vc/issuer:pr-42 make up-issuer
```

Short tags (`pr-42`, `sha-abc123`) are expanded to the default registry
in CI. Full image references are used as-is.

## Viewing results

Reports are saved to `conformance-results/`:

```bash
make test-issuer
unzip conformance-results/conformance-report-*.zip -d /tmp/report
open /tmp/report/index.html
```

Or generate a markdown summary:

```bash
node scripts/generate-summary.mjs ./conformance-results
```

## Adding a new variant

1. Add an entry to `VCI_VARIANTS` or `VP_VARIANTS` in the spec file
2. If the variant needs different keys or endpoints, create a config in `configs/conformance/`
3. Run locally with `make up-wallet && make test-wallet`
4. Open a PR

## Directory structure

```
compose/                    # Docker Compose files (image-only, no builds)
configs/conformance/        # Conformance suite test plan configurations
fixtures/                   # VC service config, PKI, metadata, test users
helpers/                    # Playwright helper modules
specs/conformance/          # Test specs (variant definitions here)
scripts/                    # Summary generation, comment parsing, publishing
.github/workflows/          # CI workflows
```

## CI and `@conformance` triggers

CI workflows run weekly, on push to `main`, and via manual/repository dispatch.
For the full CI documentation — including `@conformance` PR comment syntax,
image overrides, and cross-repo triggers — see the
[Running Conformance Tests](https://sirosfoundation.github.io/docs/howto/running-conformance-tests) guide.

[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/sirosfoundation/siros-conformance/badge)](https://scorecard.dev/viewer/?uri=github.com/sirosfoundation/siros-conformance)
## License

BSD 2-Clause — see [LICENSE](LICENSE).
