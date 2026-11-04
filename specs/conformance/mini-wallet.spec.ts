/**
 * Mini-wallet Conformance Tests — the raw Rust engine core
 *
 * Runs the OpenID Foundation Conformance Suite OID4VCI wallet test plan
 * against the wasm mini-wallet (engine-adapter-wasm's harness page,
 * docs/oidf-conformance.md in siros-wallet-core) instead of
 * wallet-frontend + go-wallet-backend: the same suites judge the raw
 * engine by its HTTP traffic. Phase 1 of the conformance plan — the
 * issuance half.
 *
 * This spec deliberately uses no wallet-frontend or wallet-backend:
 * the mini-wallet profile disables both, the mini host auto-consents
 * with a generated device key, and go-trust-allow answers every trust
 * evaluation (always-trusted) — so there is no tenant to create and no
 * issuer to register.
 *
 * The page's URL contract (target/wasm-page):
 *   ?offer=<url>     — the suite's credential offer link
 *   ?request=<url>   — the OID4VP authorization request
 *   ?code&state      — the authorization-code redirect's return
 *
 * Prerequisites:
 *   - `make wasm-page` in the siros-wallet-core checkout, then
 *     WALLET_PAGE_DIR=<…>/target/wasm-page make up-mini-wallet
 *   - /etc/hosts entry: 127.0.0.1 localhost.emobix.co.uk
 */

import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { ConformanceAPI, type TestState } from '../../helpers/conformance-api';

// =============================================================================
// Configuration
// =============================================================================

const CONFORMANCE_URL = process.env.CONFORMANCE_URL || 'https://localhost.emobix.co.uk:8443/';
const MINI_WALLET_URL = process.env.MINI_WALLET_URL || 'http://localhost:3010/';
const VCI_PLAN_NAME = 'oid4vci-1_0-wallet-test-plan';
const VCI_CONFIG_PATH = path.resolve(
  __dirname,
  '../../configs/conformance/vci-wallet-config.json'
);

// The pre-authorized variants: the issuance half the raw engine answers
// through the mini host today (no sender constrain, no client auth —
// the proof is the self-asserted device key's).
const VARIANTS = [
  {
    name: 'sd_jwt_vc / pre-authorized_code / immediate',
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
  {
    name: 'sd_jwt_vc / pre-authorized_code / deferred',
    variant: {
      credential_format: 'sd_jwt_vc',
      vci_grant_type: 'pre_authorization_code',
      vci_credential_issuance_mode: 'deferred',
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

// =============================================================================
// Tests
// =============================================================================

test.describe('Mini-wallet (the raw Rust engine core) — OID4VCI', () => {
  const api = new ConformanceAPI(CONFORMANCE_URL);
  let conformanceReady: boolean;

  test.beforeAll(async () => {
    try {
      await api.waitForServerReady(30000);
      conformanceReady = true;
    } catch (error) {
      console.log('Conformance suite not available:', (error as Error).message);
      conformanceReady = false;
    }
  });

  test.beforeEach(async () => {
    test.skip(!conformanceReady, 'Conformance suite not available');
  });

  for (const variantConfig of VARIANTS) {
    test.describe(`Variant: ${variantConfig.name}`, () => {
      test('should pass all VCI conformance modules against the raw engine', async ({ page }) => {
        test.setTimeout(600_000);

        const config = JSON.parse(fs.readFileSync(VCI_CONFIG_PATH, 'utf-8'));
        if (process.env.GITHUB_ACTOR) config.developer = process.env.GITHUB_ACTOR;
        if (process.env.GITHUB_SHA) {
          config.description = `${config.description || ''} [mini-wallet ${process.env.GITHUB_SHA.slice(0, 7)}]`.trim();
        }
        const configJson = JSON.stringify(config);

        const plan = await api.createTestPlan(VCI_PLAN_NAME, configJson, variantConfig.variant);
        const planId = plan.id;
        const planModules = plan.modules.map((m) => m.testModule);
        console.log(`[mini-wallet] Created plan ${planId} with ${planModules.length} modules`);

        const results: Array<{
          module: string;
          status: string;
          result: string;
          passed: boolean;
        }> = [];

        for (const moduleName of planModules) {
          console.log(`\n[mini-wallet] === Module: ${moduleName} ===`);

          const moduleInfo = await api.createTestFromPlan(planId, moduleName);
          const moduleId = moduleInfo.id;

          let state: TestState;
          try {
            state = await api.waitForState(moduleId, ['WAITING', 'FINISHED'], 60000);
          } catch (error) {
            console.log(`Module ${moduleName} never reached WAITING: ${(error as Error).message}`);
            results.push({ module: moduleName, status: 'ERROR', result: 'TIMEOUT', passed: false });
            continue;
          }

          if (state === 'FINISHED') {
            const info = await api.getModuleInfo(moduleId);
            console.log(`Module ${moduleName} finished immediately: ${info.result}`);
            results.push({
              module: moduleName,
              status: info.status,
              result: info.result,
              passed: info.result === 'PASSED',
            });
            continue;
          }

          // WAITING: the suite published the offer; the mini-wallet
          // takes it by URL.
          const interactionUrl = await api.getWalletInteractionUrl(moduleId);
          if (!interactionUrl) {
            console.log(`Module ${moduleName}: no interaction URL`);
            results.push({ module: moduleName, status: 'ERROR', result: 'NO_URL', passed: false });
            continue;
          }
          console.log(`[mini-wallet] Offer: ${interactionUrl.slice(0, 100)}…`);

          const walletUrl = `${MINI_WALLET_URL}?offer=${encodeURIComponent(interactionUrl)}`;
          await page.goto(walletUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

          // The page's data-flow-state polls the engine's WMP answer.
          await page
            .waitForFunction(
              () =>
                document.body.getAttribute('data-flow-state') === 'completed' ||
                document.body.getAttribute('data-flow-state') === 'error',
              undefined,
              { timeout: 120_000 }
            )
            .catch(() => null);
          const flowState = await page.getAttribute('body', 'data-flow-state');
          console.log(`[mini-wallet] Flow state: ${flowState}`);

          const finalInfo = await api.waitForState(moduleId, ['FINISHED'], 180000).then(
            async () => api.getModuleInfo(moduleId),
            () => api.getModuleInfo(moduleId)
          );
          console.log(`Module ${moduleName}: ${finalInfo.result}`);
          results.push({
            module: moduleName,
            status: finalInfo.status,
            result: finalInfo.result,
            // SKIPPED is not a failure: the suite skips the modules the
            // plan variant does not exercise (e.g. batch issuance).
            passed: finalInfo.result === 'PASSED' || finalInfo.result === 'SKIPPED',
          });
        }

        console.table(results);
        const failures = results.filter((r) => !r.passed);
        expect(failures, `suite failures: ${JSON.stringify(failures, null, 2)}`).toHaveLength(0);
      });
    });
  }
});
