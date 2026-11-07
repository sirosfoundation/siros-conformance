.PHONY: install up-issuer up-verifier up-verifier-core up-issuer-core up-wallet up-android up-mini-wallet down test-issuer test-verifier test-verifier-core test-issuer-core \
	test-wallet test-wallet-vci test-wallet-vp \
	test-mini-wallet test-mini-wallet-vci test-mini-wallet-vp \
	test-android test-android-vci test-android-vp

COMPOSE := docker compose
ISSUER_CORE := -f compose/siros-issuer-core.yml
CONFORMANCE := -f compose/conformance-suite.yml
VC_SERVICES := -f compose/vc-services.yml
GO_TRUST := -f compose/go-trust.yml
WALLET := -f compose/wallet.yml
MINI_WALLET := -f compose/wallet.yml -f compose/mini-wallet.yml
ANDROID := -f compose/android-wallet.yml
CORE := -f compose/siros-verifier-core.yml

# ── Install ──────────────────────────────────────────────────────────────────
install:
	npm ci
	npx playwright install chromium --with-deps

# ── Compose profiles ────────────────────────────────────────────────────────
up-issuer:
	$(COMPOSE) $(VC_SERVICES) $(GO_TRUST) $(CONFORMANCE) up -d

up-verifier:
	$(COMPOSE) $(VC_SERVICES) $(GO_TRUST) $(CONFORMANCE) up -d

up-verifier-core:
	$(COMPOSE) $(CORE) $(GO_TRUST) $(CONFORMANCE) up -d

up-issuer-core:
	$(COMPOSE) $(ISSUER_CORE) $(GO_TRUST) $(CONFORMANCE) up -d

up-wallet:
	$(COMPOSE) $(WALLET) $(GO_TRUST) $(VC_SERVICES) $(CONFORMANCE) up -d

# The raw Rust engine as the wallet under test: the mini-wallet page
# replaces wallet-frontend + wallet-backend (docs/oidf-conformance.md).
# Build the page first: `make wasm-page` in the siros-wallet-core
# checkout, then WALLET_PAGE_DIR=<…>/target/wasm-page here.
up-mini-wallet:
	$(COMPOSE) $(MINI_WALLET) $(GO_TRUST) $(VC_SERVICES) $(CONFORMANCE) up -d --remove-orphans

down:
	$(COMPOSE) $(WALLET) $(MINI_WALLET) $(VC_SERVICES) $(CORE) $(GO_TRUST) $(CONFORMANCE) down -v 2>/dev/null; true

pull:
	$(COMPOSE) $(WALLET) $(VC_SERVICES) $(CORE) $(GO_TRUST) $(CONFORMANCE) pull

# ── Tests ────────────────────────────────────────────────────────────────────
test-issuer:
	NODE_TLS_REJECT_UNAUTHORIZED=0 npx playwright test specs/conformance/oid4vci-issuer.spec.ts

test-verifier:
	NODE_TLS_REJECT_UNAUTHORIZED=0 npx playwright test specs/conformance/oid4vp-verifier.spec.ts

test-verifier-core:
	VERIFIER_IMPL=core NODE_TLS_REJECT_UNAUTHORIZED=0 npx playwright test specs/conformance/oid4vp-verifier.spec.ts

test-issuer-core:
	NODE_TLS_REJECT_UNAUTHORIZED=0 npx playwright test specs/conformance/oid4vci-issuer-core.spec.ts

test-wallet-vci:
	NODE_TLS_REJECT_UNAUTHORIZED=0 npx playwright test specs/conformance/oid4vci-wallet.spec.ts

test-wallet-vp:
	NODE_TLS_REJECT_UNAUTHORIZED=0 npx playwright test specs/conformance/oid4vp-wallet.spec.ts

test-wallet: test-wallet-vci test-wallet-vp

# The raw engine against the OIDF plans: the mini-wallet spec drives the
# page by the same URL contract the wallet specs use.
test-mini-wallet: test-mini-wallet-vci test-mini-wallet-vp

test-mini-wallet-vci:
	NODE_TLS_REJECT_UNAUTHORIZED=0 npx playwright test specs/conformance/mini-wallet.spec.ts

test-mini-wallet-vp:
	NODE_TLS_REJECT_UNAUTHORIZED=0 npx playwright test specs/conformance/mini-wallet-vp.spec.ts

# ── Android wallet tests (via ADB / Waydroid) ───────────────────────────────
up-android:
	$(COMPOSE) $(WALLET) $(GO_TRUST) $(VC_SERVICES) $(CONFORMANCE) $(ANDROID) up -d

test-android-vci:
	NODE_TLS_REJECT_UNAUTHORIZED=0 ADB_WALLET=1 npx playwright test specs/conformance/oid4vci-android-wallet.spec.ts

test-android-vp:
	NODE_TLS_REJECT_UNAUTHORIZED=0 ADB_WALLET=1 npx playwright test specs/conformance/oid4vp-android-wallet.spec.ts

test-android: test-android-vci test-android-vp

# ── Full cycle ──────────────────────────────────────────────────────────────
ci-issuer: up-issuer test-issuer
ci-verifier: up-verifier test-verifier
ci-verifier-core: up-verifier-core test-verifier-core
ci-issuer-core: up-issuer-core test-issuer-core
ci-wallet: up-wallet test-wallet
ci-android: up-android test-android
