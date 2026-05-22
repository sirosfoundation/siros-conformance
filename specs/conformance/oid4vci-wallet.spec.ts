/**
 * OpenID4VCI Wallet Conformance Tests
 *
 * Runs the OpenID Foundation Conformance Suite OID4VCI wallet test plan.
 * The conformance suite acts as an issuer and the wallet must accept
 * credential offers.
 *
 * Prerequisites:
 *   - Conformance suite running
 *   - Wallet stack running with allow-all trust
 *   - /etc/hosts entry: 127.0.0.1 localhost.emobix.co.uk
 */

import { test, expect } from '../../helpers/tenant-setup-fixture';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { ConformanceAPI, type TestState } from '../../helpers/conformance-api';
import { loginUserViaUI } from '../../helpers/ui-actions';
import { ENV } from '../../helpers/shared-helpers';
import { WebAuthnHelper } from '../../helpers/webauthn';

// =============================================================================
// Configuration
// =============================================================================

const CONFORMANCE_URL = process.env.CONFORMANCE_URL || 'https://localhost.emobix.co.uk:8443/';
const FRONTEND_URL = ENV.FRONTEND_URL;

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
];

const VCI_PLAN_NAME = 'oid4vci-1_0-wallet-test-plan';
const VCI_CONFIG_PATH = path.resolve(__dirname, '../../configs/conformance/vci-wallet-config.json');
const RESULTS_DIR = process.env.CONFORMANCE_RESULTS_DIR || path.resolve(__dirname, '../../conformance-results');

// =============================================================================
// Tests
// =============================================================================

test.describe('OID4VCI Wallet Conformance Suite', () => {
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

    for (const variantConfig of VCI_VARIANTS) {
      test.describe(`Variant: ${variantConfig.name}`, () => {
        let planId: string;
        let planModules: string[];

        test.beforeAll(async () => {
          if (!conformanceReady) return;

          const configJson = fs.readFileSync(VCI_CONFIG_PATH, 'utf-8');

          const plan = await api.createTestPlan(
            VCI_PLAN_NAME,
            configJson,
            variantConfig.variant
          );
          planId = plan.id;
          planModules = plan.modules.map((m) => m.testModule);

          console.log(`Created plan ${planId} with ${planModules.length} modules:`);
          planModules.forEach((m) => console.log(`  - ${m}`));
        });

        test('should have created a test plan', () => {
          expect(planId).toBeDefined();
          expect(planModules.length).toBeGreaterThan(0);
        });

        test('should pass all VCI conformance modules', async ({ page, tenantContext }) => {
          test.setTimeout(300000);

          expect(planId).toBeDefined();
          expect(planModules.length).toBeGreaterThan(0);

          // Register conformance suite issuer for this tenant
          const configJson = JSON.parse(fs.readFileSync(VCI_CONFIG_PATH, 'utf-8'));
          const conformanceClientId = configJson.client?.client_id || 'siros-wallet-test';
          const conformanceIssuerUrl = CONFORMANCE_URL.replace(/\/$/, '') + '/test/a/' + (configJson.alias || 'siros-wallet-vci-test') + '/';

          const clientKeyWithPrivate = configJson.client?.private_key ||
            configJson.client?.jwks?.keys?.find((k: any) => k.d);
          const clientPrivateKeyJwk = clientKeyWithPrivate ? JSON.stringify(clientKeyWithPrivate) : null;

          const issuerResp = await fetch(`${ENV.ADMIN_URL}/admin/tenants/${tenantContext.tenantId}/issuers`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${ENV.ADMIN_TOKEN}`,
            },
            body: JSON.stringify({
              credential_issuer_identifier: conformanceIssuerUrl,
              client_id: conformanceClientId,
              client_jwk: clientPrivateKeyJwk,
              visible: true,
            }),
          });
          console.log(`Registered conformance issuer for tenant: ${issuerResp.status} (client_id=${conformanceClientId}, has_jwk=${!!clientPrivateKeyJwk})`);

          // Set up CDP virtual authenticator
          const webauthn = new WebAuthnHelper(page);
          await webauthn.initialize();
          await webauthn.injectPrfMock();
          await webauthn.addPlatformAuthenticator();

          if (tenantContext.credentials) {
            for (const cred of tenantContext.credentials) {
              await webauthn.addCredential(cred);
            }
          }

          // Login
          const loginResult = await loginUserViaUI(page, { tenantId: tenantContext.tenantId });
          expect(loginResult.success).toBe(true);

          await page.waitForURL((url) => !url.toString().includes('/login'), { timeout: 15000 }).catch(() => {});
          await page.waitForTimeout(3000);

          if (page.url().includes('/login')) {
            const continueBtn = page.locator('button:has-text("Continue")');
            if (await continueBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
              await continueBtn.click();
              await page.waitForURL((url) => !url.toString().includes('/login'), { timeout: 15000 });
              await page.waitForTimeout(2000);
            }
          }

          // Dismiss welcome tour
          const welcomeDismiss = page.locator('button:has-text("Dismiss")');
          if (await welcomeDismiss.isVisible({ timeout: 3000 }).catch(() => false)) {
            await welcomeDismiss.click();
            await page.waitForTimeout(1000);
          }

          // Handle dialogs
          page.on('dialog', async (dialog) => {
            if (dialog.type() === 'prompt') {
              await dialog.accept('123456');
            } else {
              await dialog.accept();
            }
          });

          const results: Array<{
            module: string;
            status: string;
            result: string;
            passed: boolean;
          }> = [];

          for (const moduleName of planModules) {
            console.log(`\n=== Running module: ${moduleName} ===`);

            const moduleInfo = await api.createTestFromPlan(planId, moduleName);
            const moduleId = moduleInfo.id;
            console.log(`Module ${moduleName} created: ${moduleId}`);

            let state: TestState;
            try {
              state = await api.waitForState(moduleId, ['WAITING', 'FINISHED'], 60000);
            } catch (error) {
              console.log(`Module ${moduleName} failed to reach WAITING: ${(error as Error).message}`);
              results.push({
                module: moduleName,
                status: 'ERROR',
                result: 'TIMEOUT',
                passed: false,
              });
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

            // Module is WAITING — get credential offer URL
            const interactionUrl = await api.getWalletInteractionUrl(moduleId);
            if (!interactionUrl) {
              const browserUrl = await api.getBrowserInteractionUrl(moduleId);
              if (!browserUrl) {
                console.log(`Module ${moduleName}: no interaction URL found`);
                results.push({
                  module: moduleName,
                  status: 'ERROR',
                  result: 'NO_URL',
                  passed: false,
                });
                continue;
              }
              await page.goto(browserUrl, { waitUntil: 'networkidle', timeout: 15000 });
            } else {
              console.log(`Module ${moduleName}: accepting offer via ${interactionUrl.slice(0, 80)}...`);

              const offerParams = interactionUrl.replace('openid-credential-offer://?', '');
              const tenantBasePath = `/id/${tenantContext.tenantId}/`;

              await page.evaluate(({ basePath, params }) => {
                window.history.pushState(null, '', `${basePath}?${params}`);
                window.dispatchEvent(new PopStateEvent('popstate', { state: null }));
              }, { basePath: tenantBasePath, params: offerParams });

              let spaNavigationWorked = false;
              try {
                await page.waitForURL((url) => url.pathname.includes('/cb'), { timeout: 10000 });
                spaNavigationWorked = true;
              } catch {
                console.log(`Module ${moduleName}: SPA navigation to /cb timed out, trying full navigation...`);
              }

              if (!spaNavigationWorked) {
                const cbUrl = `${FRONTEND_URL}/id/${tenantContext.tenantId}/cb?${offerParams}`;
                await page.goto(cbUrl, { waitUntil: 'networkidle', timeout: 30000 });
                await page.waitForTimeout(2000);

                const loginBtn = page.locator('button:has-text("Log in with a Passkey")');
                if (await loginBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
                  await loginBtn.click();
                  await page.waitForTimeout(5000);
                }
              }

              // Handle UI popups
              const dismissBtn = page.locator('button:has-text("Dismiss")');
              if (await dismissBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
                await dismissBtn.click();
                await page.waitForTimeout(1000);
              }

              const txCodeInput = page.locator('input[placeholder*="character code"]');
              const txSubmitBtn = page.locator('button:has-text("Submit")');
              try {
                await txCodeInput.waitFor({ state: 'visible', timeout: 15000 });
                await txCodeInput.fill('123456');
                await txSubmitBtn.click();
              } catch {
                // No TX code popup
              }

              await page.waitForTimeout(15000);
            }

            try {
              await api.waitForState(moduleId, ['FINISHED'], 60000);
            } catch {
              console.log(`Module ${moduleName} did not finish in time`);
            }

            const finalInfo = await api.getModuleInfo(moduleId);
            console.log(`Module ${moduleName} result: ${finalInfo.result}`);

            results.push({
              module: moduleName,
              status: finalInfo.status,
              result: finalInfo.result,
              passed: finalInfo.result === 'PASSED',
            });

            await page.goto(`${FRONTEND_URL}/`, { waitUntil: 'networkidle', timeout: 10000 });
            await page.waitForTimeout(1000);
          }

          // Export report
          try {
            const reportPath = await api.exportPlanResults(planId, RESULTS_DIR);
            console.log(`\nConformance report exported: ${reportPath}`);
          } catch (error) {
            console.log(`Failed to export report: ${(error as Error).message}`);
          }

          // Report results
          const passed = results.filter((r) => r.passed);
          const failed = results.filter((r) => !r.passed);

          // Write JSON summary
          const summary = {
            profile: 'wallet-vci',
            plan: VCI_PLAN_NAME,
            planId,
            variant: variantConfig.name,
            timestamp: new Date().toISOString(),
            planDetailUrl: api.getPlanDetailUrl(planId),
            total: results.length,
            passed: passed.length,
            failed: failed.length,
            modules: results,
          };
          fs.mkdirSync(RESULTS_DIR, { recursive: true });
          fs.writeFileSync(
            path.join(RESULTS_DIR, 'wallet-vci-summary.json'),
            JSON.stringify(summary, null, 2)
          );

          console.log('\n=== VCI Wallet Conformance Results ===');

          console.log(`Total: ${results.length} | Passed: ${passed.length} | Failed: ${failed.length}`);

          if (failed.length > 0) {
            console.log('\nFailed modules:');
            failed.forEach((r) =>
              console.log(`  ✗ ${r.module}: ${r.result} (${r.status})`)
            );
          }

          if (passed.length > 0) {
            console.log('\nPassed modules:');
            passed.forEach((r) => console.log(`  ✓ ${r.module}`));
          }

          console.log(`\nFull results: ${api.getPlanDetailUrl(planId)}`);

          expect(failed.length, `${failed.length} modules failed: ${failed.map((r) => r.module).join(', ')}`).toBe(0);
        });
      });
    }
  });
});
