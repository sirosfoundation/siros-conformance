.PHONY: install up-issuer up-verifier up-wallet up-android down test-issuer test-verifier \
	test-wallet test-wallet-vci test-wallet-vp \
	test-android test-android-vci test-android-vp

COMPOSE := docker compose
CONFORMANCE := -f compose/conformance-suite.yml
VC_SERVICES := -f compose/vc-services.yml
GO_TRUST := -f compose/go-trust.yml
WALLET := -f compose/wallet.yml
ANDROID := -f compose/android-wallet.yml

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
ci-wallet: up-wallet test-wallet
ci-android: up-android test-android
