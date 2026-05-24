# Adding Variants to the Conformance Suite

Step-by-step guide for adding new variant combinations to the SIROS
conformance tests.

---

## Quick Reference

A **variant** is a named combination of conformance suite dimension values.
Each variant runs the same set of test modules but with different protocol
parameters (credential format, grant type, response mode, etc.).

Variants are defined in two places:
- **Spec file** — `specs/conformance/oid4vci-wallet.spec.ts` or
  `specs/conformance/oid4vp-wallet.spec.ts` — the `VCI_VARIANTS` /
  `VP_VARIANTS` array
- **Config file** — `configs/conformance/*.json` — server/client keys and
  endpoints

---

## Adding a P0 Variant (same config)

P0 variants need only a new entry in the variant array. The existing config
file works unchanged.

### Example: Add authorization_code grant to VCI wallet

Edit `specs/conformance/oid4vci-wallet.spec.ts`:

```typescript
const VCI_VARIANTS = [
  {
    name: 'sd_jwt_vc / pre-authorized_code / immediate / by_value',
    variant: {
      credential_format: 'sd_jwt_vc',
      vci_grant_type: 'pre_authorization_code',
      vci_credential_issuance_mode: 'immediate',
      vci_credential_offer_variant: 'by_value',
      sender_constrain: 'dpop',
      vci_credential_encryption: 'plain',
      fapi_profile: 'vci',
      fapi_request_method: 'unsigned',
      client_auth_type: 'private_key_jwt',
      authorization_request_type: 'simple',
      vci_authorization_code_flow_variant: 'issuer_initiated',
    },
  },
  // ← Add new variant here
  {
    name: 'sd_jwt_vc / authorization_code / immediate / by_value',
    variant: {
      credential_format: 'sd_jwt_vc',
      vci_grant_type: 'authorization_code',        // ← changed
      vci_credential_issuance_mode: 'immediate',
      vci_credential_offer_variant: 'by_value',
      sender_constrain: 'dpop',
      vci_credential_encryption: 'plain',
      fapi_profile: 'vci',
      fapi_request_method: 'unsigned',
      client_auth_type: 'private_key_jwt',
      authorization_request_type: 'simple',
      vci_authorization_code_flow_variant: 'issuer_initiated',
    },
  },
];
```

**Important:** Every dimension must be specified. The suite does not use
defaults — omitting a dimension causes a 400 error on plan creation.

### Valid dimension values

See [variant-reference.md](variant-reference.md) for the complete list of
values per dimension.

---

## Adding a Variant That Needs a New Config

When a variant changes the credential format (e.g., `mdoc` / `iso_mdl`) or
requires different keys, you need a new config file.

### Step 1: Create the config file

Copy the existing config and modify:

```bash
cp configs/conformance/vci-wallet-config.json \
   configs/conformance/vci-wallet-mdoc-config.json
```

For mdoc VCI, the main changes are:
- The credential signing key may need x5c with the right issuer cert
- No `vct` field — mdoc uses `doctype` instead

For iso_mdl VP, the main changes are:
- `server.authorization_endpoint` should be `mdoc-openid4vp://`
  (different URI scheme for mdoc credentials)
- Need both `sig` and `enc` keys in the client JWKS
- DCQL query references mdoc namespace paths instead of SD-JWT claim paths

### Step 2: Add the variant with config path

The spec files currently use a single config path. To support multiple configs
per variant, extend the variant entry:

```typescript
{
  name: 'mdoc / pre-authorized_code / immediate / by_value',
  configPath: '../../configs/conformance/vci-wallet-mdoc-config.json',  // optional override
  variant: {
    credential_format: 'mdoc',
    // ... rest of dimensions
  },
},
```

Then update `loadConfig()` to accept the path from the variant entry:

```typescript
function loadConfig(variantConfig): string {
  const configPath = variantConfig.configPath
    ? path.resolve(__dirname, variantConfig.configPath)
    : VCI_CONFIG_PATH;
  // ...
}
```

### Step 3: Handle format-specific test flow differences

The test flow may differ by credential format:

| Step | SD-JWT VC | mdoc |
|------|-----------|------|
| Credential offer URL scheme | `openid-credential-offer://` | `openid-credential-offer://` (same) |
| Credential request format | `"format": "vc+sd-jwt"` | `"format": "mso_mdoc"` |
| Proof type | JWT proof of possession | JWT proof of possession (same) |
| Response parsing | SD-JWT string | CBOR-encoded mdoc |

If the wallet handles these differences transparently (which it should), the
test flow in the spec file doesn't need to change — only the config and variant
dimensions.

---

## Adding a New Test Plan

To add an entirely new test plan (e.g., HAIP or ID3):

### Step 1: Create a new spec file or extend an existing one

For HAIP wallet plans, you can add them to the existing wallet spec files since
the test flow is identical — only the variant space is constrained.

```typescript
// In oid4vp-wallet.spec.ts, add a second test.describe block:

const VP_HAIP_PLAN_NAME = 'oid4vp-1final-wallet-haip-test-plan';

const VP_HAIP_VARIANTS = [
  {
    name: 'sd_jwt_vc / direct_post.jwt',
    variant: {
      credential_format: 'sd_jwt_vc',
      response_mode: 'direct_post.jwt',
    },
  },
];

test.describe('OID4VP Wallet HAIP Conformance', () => {
  // ... same structure as the plain VP test
});
```

For ID3, create a new spec file since the modules and flow may differ:
`specs/conformance/oid4vp-id3-wallet.spec.ts`

### Step 2: Add the compose/workflow support

If the new plan needs the same services, no compose changes are needed.
Add the spec file path to the workflow's `paths` trigger.

### Step 3: Update the summary generator

The `scripts/generate-summary.mjs` and `scripts/publish-pages.mjs` scripts
auto-discover summary JSON files, so new plans should appear automatically.

---

## Testing Locally

```bash
# Start services
make up-wallet

# Run a specific variant by filtering on describe name
npx playwright test specs/conformance/oid4vci-wallet.spec.ts \
  --grep "authorization_code"

# Run all variants
make test-wallet
```

---

## Checklist

- [ ] Variant entry added to spec file with all required dimensions
- [ ] Config file created (if needed) with correct keys and endpoints
- [ ] Local test run passes: `make up-wallet && make test-wallet`
- [ ] Variant name follows convention: `format / key_dimension / key_dimension`
- [ ] Summary JSON includes the variant name
- [ ] PR description mentions which variant was added and why
