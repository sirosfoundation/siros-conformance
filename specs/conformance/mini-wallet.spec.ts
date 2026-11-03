/**
 * Mini-wallet Conformance Tests — the raw Rust engine core
 *
 * Runs the OpenID Foundation Conformance Suite OID4VCI wallet test plan
 * against the wasm mini-wallet (engine-adapter-wasm's harness page,
 * docs/oidf-conformance.md in siros-wallet-core) instead of
 * wallet-frontend + go-wallet-backend: the same suites judge the raw
 * engine by its HTTP traffic. Phase 1 of the conformance plan — the
 * issuance half; the presentation half arrives with the VP builder.
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

import { test, expect } from '../../helpers/tenant-setup-fixture';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { ConformanceAPI, type TestState } from '../../helpers/conformance-api';
import { ENV } from '../../helpers/shared-helpers';

// =============================================================================
// Configuration
// =============================================================================

const CONFORMANCE_URL = process.env.CONFORMANCE_URL || 'https://localhost.emobix.co.uk:8443/';
const MINI_WALLET_URL = process.env.MINI_WALLET_URL || 'http://localhost:3010/';
const VCI_PLAN_NAME = 'oid4vci-1_0-wallet-test-plan';
const VCI_DEFAULT_CONFIG_PATH = path.resolve(
  __dirname,
  '../../configs/conformance/vci-wallet-config.json'
);

// The pre-authorized variants: the issuance half the raw engine can
// answer through the mini host today. The authorization_code grant's
// browser-login step exercises the page's redirect-return path.
const VARIANTS = [
  {
    name: 'sd_jwt_vc / pre-authorized_code / immediate',
    variant: {
      credential_format: 'sd_jwt_vc',
      vci_grant_type: 'pre_authorization_code',
      vci_credential_issuance_mode: 'immediate',
      vci_credential_offer_variant: 'by_value',
      sender_constrain: 'none',
      vci_credential_encryption: 'plain',
      client_auth_type: 'none',
    },
  },
  {
    name: 'sd_jwt_vc / pre-authorized_code / deferred',
    variant: {
      credential_format: 'sd_jwt_vc',
      vci_grant_type: 'pre_authorization_code',
      vci_credential_issuance_mode: 'deferred',
      vci_credential_offer_variant: 'by_value',
      sender_constrain: 'none',
      vci_credential_encryption: 'plain',
      client_auth_type: 'none',
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
    if (!conformanceReady) {
      test.skip(true, 'Conformance suite not available');
      return;
    }
  });

  test.describe('VCI Conformance Tests', () => {
    test.beforeEach(async ({ tenantContext }) => {
      if (!tenantContext.ready) {
        test.skip(true, tenantContext.error || 'Tenant setup failed');
        return;
      }
    });

    for (const variantConfig of VARIANTS) {
      test.describe(`Variant: ${variantConfig.name}`, () => {
        let planId: string;
        let planModules: string[];

        test.beforeAll(async () => {
          if (!conformanceReady) return;

          const config = JSON.parse(fs.readFileSync(VCI_DEFAULT_CONFIG_PATH, 'utf-8'));
          if (process.env.GITHUB_ACTOR) config.developer = process.env.GITHUB_ACTOR;
          if (process.env.GITHUB_SHA) {
            config.description = `${config.description || ''} [mini-wallet ${process.env.GITHUB_SHA.slice(0, 7)}]`.trim();
          }
          const configJson = JSON.stringify(config);

          const plan = await api.createTestPlan(VCI_PLAN_NAME, configJson, variantConfig.variant);
          planId = plan.id;
          planModules = plan.modules.map((m) => m.testModule);

          console.log(`[mini-wallet] Created plan ${planId} with ${planModules.length} modules`);
        });

        test('should have created a test plan', () => {
          expect(planId).toBeDefined();
          expect(planModules.length).toBeGreaterThan(0);
        });

        test('should pass all VCI conformance modules against the raw engine', async ({
          page,
          tenantContext,
        }) => {
          test.setTimeout(300000);

          expect(planId).toBeDefined();

          // Register the conformance suite's issuer with the tenant's
          // registry, exactly as the wallet-frontend spec does — the
          // mini-wallet's PDP callback resolves trust through the same
          // backend.
          const configJson = JSON.parse(fs.readFileSync(VCI_DEFAULT_CONFIG_PATH, 'utf-8'));
          const conformanceIssuerUrl =
            CONFORMANCE_URL.replace(/\/$/, '') +
            '/test/a/' +
            (configJson.alias || 'siros-wallet-vci-test') +
            '/';

          const issuerResp = await fetch(
            `${ENV.ADMIN_URL}/admin/tenants/${tenantContext.tenantId}/issuers`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${ENV.ADMIN_TOKEN}`,
              },
              body: JSON.stringify({
                credential_issuer_identifier: conformanceIssuerUrl,
                client_id: 'siros-wallet-test',
                visible: true,
              }),
            }
          );
          console.log(`[mini-wallet] Registered conformance issuer: ${issuerResp.status}`);

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

            // WAITING: the suite published the offer. The mini-wallet
            // takes it by URL.
            const interactionUrl = await api.getWalletInteractionUrl(moduleId);
            if (!interactionUrl) {
              console.log(`Module ${moduleName}: no interaction URL`);
              results.push({ module: moduleName, status: 'ERROR', result: 'NO_URL', passed: false });
              continue;
            }
            console.log(`[mini-wallet] Offer: ${interactionUrl.slice(0, 80)}…`);

            const walletUrl = `${MINI_WALLET_URL}?offer=${encodeURIComponent(interactionUrl)}`;
            await page.goto(walletUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

            // The page's data-flow-state polls the engine's WMP answer.
            const flowState = await page
              .waitForSelector('[data-flow-state="completed"], [data-flow-state="error"]', {
                timeout: 90000,
              })
              .then(() => page.getAttribute('body', 'data-flow-state'))
              .catch(() => 'timeout');
            console.log(`[mini-wallet] Flow state: ${flowState}`);

            const info = await api.getModuleInfo(moduleId);
            const finalState = await api.waitForState(moduleId, ['FINISHED'], 120000).catch(
              () => null
            );
            const finalInfo = finalState ? await api.getModuleInfo(moduleId) : info;
            console.log(`Module ${moduleName}: ${finalInfo.result}`);
            results.push({
              module: moduleName,
              status: finalInfo.status,
              result: finalInfo.result,
              passed: finalInfo.result === 'PASSED',
            });
          }

          console.table(results);
          const failures = results.filter((r) => !r.passed);
          expect(
            failures,
            `suite failures: ${JSON.stringify(failures, null, 2)}`
          ).toHaveLength(0);
        });
      });
    }
  });
});
