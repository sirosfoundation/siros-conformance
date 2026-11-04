# Mini-wallet conformance results — 2026-11-04

**Phase 1 green: the OIDF OID4VCI wallet plan passes against the raw Rust
engine.** Both variants of the agreed plan — `sd_jwt_vc` /
`pre_authorization_code`, immediate and deferred issuance, DPoP
sender-constrain, `private_key_jwt` client auth — passed every applicable
module:

| module | immediate | deferred |
|---|---|---|
| `oid4vci-1_0-wallet-test-credential-issuance` | PASSED | PASSED |
| `oid4vci-1_0-wallet-test-credential-issuance-notification` | PASSED | PASSED |
| `oid4vci-1_0-wallet-happy-path-with-scopes-without-authorization-details-in-token-response` | PASSED | PASSED |
| `oid4vci-1_0-wallet-test-batch-credential-issuance` | SKIPPED | SKIPPED |

The batch module is skipped by the suite itself — the agreed variant does
not exercise batch issuance.

## The evidence

- `summary.json` — the machine-readable record: suite version (5.3.4),
  plan IDs, per-module results, engine commit, the plan-detail links.
- `conformance-report-<plan>.zip` — the suite's exported HTML reports for
  the two green runs, the same artifact a certification submission uses.

The plan IDs stay live in the local suite deployment
(`https://localhost.emobix.co.uk:8443/`, `localhost.emobix.co.uk` →
127.0.0.1) for as long as its database lives; the ZIPs are the durable
copies.

## The wallet under test

Not `wallet-frontend + go-wallet-backend` — the raw engine
(`siros-wallet-core` @ `09ab930`) driven by the mini-wallet harness page
(`engine-adapter-wasm`, `make wasm-page`), whose built-in mini host
auto-consents, answers the transaction code from configuration, and holds
the two keys: the generated device key (the OID4VCI proof) and the
plan-registered client key (the RFC 7523 assertion). The suite judges the
engine by its HTTP traffic alone.

## Reproduce

```
# siros-wallet-core
cargo build -p engine-adapter-wasm --target wasm32-unknown-unknown
make wasm-page

# siros-conformance (the stack)
WALLET_PAGE_DIR=<…>/siros-wallet-core/target/wasm-page make up-mini-wallet
make test-mini-wallet
```

`specs/debug/mini-page-debug.spec.ts` drives one module with full
request/response capture (`VCI_MODE=immediate|deferred` flips the
variant) — the tool that pinned every wire fix behind this run.
