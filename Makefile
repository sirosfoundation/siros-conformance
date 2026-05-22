.PHONY: install up-issuer up-verifier up-wallet down test-issuer test-verifier test-wallet test-wallet-vci test-wallet-vp

COMPOSE := docker compose
CONFORMANCE := -f compose/conformance-suite.yml
VC_SERVICES := -f compose/vc-services.yml
GO_TRUST := -f compose/go-trust.yml
WALLET := -f compose/wallet.yml

# ── Install ──────────────────────────────────────────────────────────────────
install:
	npm ci
	npx playwright install chromium --with-deps

# ── Compose profiles ────────────────────────────────────────────────────────
up-issuer:
	$(COMPOSE) $(VC_SERVICES) $(GO_TRUST) $(CONFORMANCE) up -d

up-verifier:
	$(COMPOSE) $(VC_SERVICES) $(GO_TRUST) $(CONFORMANCE) up -d

up-wallet:
	$(COMPOSE) $(WALLET) $(GO_TRUST) $(VC_SERVICES) $(CONFORMANCE) up -d

down:
	$(COMPOSE) $(WALLET) $(VC_SERVICES) $(GO_TRUST) $(CONFORMANCE) down -v 2>/dev/null; true

pull:
	$(COMPOSE) $(WALLET) $(VC_SERVICES) $(GO_TRUST) $(CONFORMANCE) pull

# ── Tests ────────────────────────────────────────────────────────────────────
test-issuer:
	NODE_TLS_REJECT_UNAUTHORIZED=0 npx playwright test specs/conformance/oid4vci-issuer.spec.ts

test-verifier:
	NODE_TLS_REJECT_UNAUTHORIZED=0 npx playwright test specs/conformance/oid4vp-verifier.spec.ts

test-wallet-vci:
	NODE_TLS_REJECT_UNAUTHORIZED=0 npx playwright test specs/conformance/oid4vci-wallet.spec.ts

test-wallet-vp:
	NODE_TLS_REJECT_UNAUTHORIZED=0 npx playwright test specs/conformance/oid4vp-wallet.spec.ts

test-wallet: test-wallet-vci test-wallet-vp

# ── Full cycle ──────────────────────────────────────────────────────────────
ci-issuer: up-issuer test-issuer
ci-verifier: up-verifier test-verifier
ci-wallet: up-wallet test-wallet
