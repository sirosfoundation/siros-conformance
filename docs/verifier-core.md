# siros-verifier-core conformance

Run the OpenID Foundation OID4VP verifier suite against `siros-verifier-core` without changing the existing VC verifier profile.

## Run

```sh
docker build --network=host -t siros-verifier-core:local ../siros-verifier-core
make up-verifier-core
make test-verifier-core
```

Use `SIROS_VERIFIER_CORE_IMAGE` to test another image. Reports and the module summary are written to `conformance-results/`. Publish a successful run with:

```sh
node scripts/publish-pages.mjs ./conformance-results \
  --run-id <unique-run-id> --run-url <ci-or-local-run-url>
```

The current variant is `sd_jwt_vc / x509_hash / direct_post.jwt / request_uri_signed / plain_vp`. All 14 modules complete: 13 pass and `oid4vp-1final-verifier-request-uri-method-post` skips because the core currently supports GET request URIs only.

## Adapter boundaries

- `compose/siros-verifier-core.yml` starts the core, MongoDB, and an HTTPS proxy. The proxy is `conformance.example.com:9443` inside Docker and `localhost:9443` on the host.
- `fixtures/siros-verifier-core/proxy.toml` is local-test-only configuration. `allow_invalid_status_list_certificates = true` exists only for the suite's self-signed endpoints and must not be enabled in a real deployment.
- `fixtures/siros-verifier-core/signing_ec_leaf.pem` is a leaf-only request-signing chain; the self-signed root is not included in x5c.
- The suite's Java truststore and the core's `SSL_CERT_FILE` contain the local test CA. `localhost.emobix.co.uk` is aliased to the suite nginx on the shared network so status-list URLs resolve inside containers.
- The runner uses `/ui/start/qr`, pastes the resulting `openid4vp://` request into the suite's waiting page, captures the decoded result or error, and uploads evidence only while the module is still waiting.

Core protocol fixes exercised by this profile include 256-bit nonces, JSON error responses, and JWT status-list retrieval, signature verification, go-trust signer evaluation, and revocation rejection. Other token formats and unsupported request methods remain outside the supported profile.
