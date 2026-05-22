# siros-conformance

[![Issuer Conformance](https://github.com/sirosfoundation/siros-conformance/actions/workflows/issuer.yml/badge.svg)](https://github.com/sirosfoundation/siros-conformance/actions/workflows/issuer.yml)
[![Verifier Conformance](https://github.com/sirosfoundation/siros-conformance/actions/workflows/verifier.yml/badge.svg)](https://github.com/sirosfoundation/siros-conformance/actions/workflows/verifier.yml)
[![Wallet Conformance](https://github.com/sirosfoundation/siros-conformance/actions/workflows/wallet.yml/badge.svg)](https://github.com/sirosfoundation/siros-conformance/actions/workflows/wallet.yml)
[![License: BSD-2-Clause](https://img.shields.io/badge/License-BSD_2--Clause-blue.svg)](LICENSE)

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

## Image overrides (testing PR builds)

All Docker images default to `:latest` but can be overridden to test
images built from a PR branch.

### Available services

| Service name | Env var | Default image |
|-------------|---------|---------------|
| `vc-issuer` | `VC_ISSUER_IMAGE` | `ghcr.io/sirosfoundation/vc-issuer:latest` |
| `vc-verifier` | `VC_VERIFIER_IMAGE` | `ghcr.io/sirosfoundation/vc-verifier:latest` |
| `vc-apigw` | `VC_APIGW_IMAGE` | `ghcr.io/sirosfoundation/vc-apigw:latest` |
| `vc-registry` | `VC_REGISTRY_IMAGE` | `ghcr.io/sirosfoundation/vc-registry:latest` |
| `vc-mockas` | `VC_MOCKAS_IMAGE` | `ghcr.io/sirosfoundation/vc-mockas:latest` |
| `go-trust` | `GO_TRUST_IMAGE` | `ghcr.io/sirosfoundation/go-trust:latest` |
| `wallet-frontend` | `WALLET_FRONTEND_IMAGE` | `ghcr.io/sirosfoundation/wallet-frontend:latest` |
| `wallet-backend` / `go-wallet-backend` | `WALLET_BACKEND_IMAGE` | `ghcr.io/sirosfoundation/go-wallet-backend:latest` |
| `wallet-registry` / `go-wallet-registry` | `WALLET_REGISTRY_IMAGE` | `ghcr.io/sirosfoundation/go-wallet-registry:latest` |

### Local override

```bash
VC_ISSUER_IMAGE=ghcr.io/sirosfoundation/vc-issuer:pr-42 make up-issuer
```

### Workflow dispatch override

```
gh workflow run issuer.yml \
  -f image-overrides='{"vc-issuer":"pr-42"}' \
  -f target-repo=sirosfoundation/vc \
  -f target-pr=99
```

Short tags (`pr-42`, `sha-abc123`) are expanded to the default registry.
Full image references (`ghcr.io/other-org/image:tag`) are used as-is.

### PR description syntax

PR authors in connected repos can declare dependencies using a
fenced block in the PR description:

~~~markdown
```conformance-deps
vc-issuer: pr-42
wallet-frontend: sha-abc123
go-wallet-backend: feature-branch
```
~~~

The `parse-deps.mjs` script extracts these and converts them to
image override environment variables.

### Cross-repo CI trigger (repository_dispatch)

Other repos can trigger conformance tests from their own CI.
See [`examples/caller-workflow.yml`](examples/caller-workflow.yml) for
a drop-in template. The flow:

1. PR CI in repo X builds and pushes `ghcr.io/.../service:pr-N`
2. Caller workflow fires `repository_dispatch` on `siros-conformance`
3. Conformance tests run with the PR image
4. Results are posted as a comment on the PR in repo X

Required secrets:
- `CONFORMANCE_DISPATCH_TOKEN` (in repo X): PAT to trigger dispatch
- `CONFORMANCE_PR_TOKEN` (in siros-conformance): PAT to comment on PRs

## Conformance reports

Each test exports an HTML report ZIP via `GET /api/plan/exporthtml/{planId}`
and a structured JSON summary (`*-summary.json`).
Reports are saved to `conformance-results/` and uploaded as GitHub Actions artifacts (90-day retention).

### Publishing options

#### 1. GitHub Actions Job Summary (automatic)

Every CI run writes a markdown summary to the **GitHub Actions Job Summary**
tab — visible directly in the workflow run page without downloading artifacts.

#### 2. PR Comments on connected repos

Workflows accept `target-repo` and `target-pr` inputs to post a conformance
summary comment on a PR in any connected repository (e.g. `sirosfoundation/go-wallet-backend`).

**Manual dispatch with PR comment:**

```
gh workflow run issuer.yml \
  -f target-repo=sirosfoundation/go-wallet-backend \
  -f target-pr=42
```

The comment is upserted (updated in place on re-runs) and includes a table
of pass/fail per profile, collapsible failure details, and links to the CI
run and conformance suite plan detail page.

**Required secret:** `CONFORMANCE_PR_TOKEN` — a PAT or GitHub App token with
`repo` scope for the target repository. Not needed for PRs within
siros-conformance itself.

#### 3. Local HTML reports

```bash
make test-issuer
# Reports in conformance-results/
unzip conformance-results/conformance-report-*.zip -d /tmp/report
open /tmp/report/index.html
```

#### 4. Markdown from CLI

```bash
node scripts/generate-summary.mjs ./conformance-results
```

#### 5. OpenID Foundation Certification

For formal OIDF certification, run your tests against the **production
conformance suite** at `https://www.certification.openid.net/` (not the local
Docker instance). Then:

1. Use the **"Publish for certification"** button in the conformance suite UI
   to get a ZIP of your test logs.
2. Pay the certification fee at
   [openid.net/foundation/members/certifications/new](https://openid.net/foundation/members/certifications/new).
3. Submit at [submissions.openid.net](https://submissions.openid.net/) with
   the ZIP, payment code, and declaration of conformance.

See [How to certify your implementation](https://openid.net/how-to-certify-your-implementation/)
for full instructions.

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
scripts/                    # Summary generation and publishing scripts
.github/workflows/          # CI workflows
```

## License

BSD 2-Clause — see [LICENSE](LICENSE).
