/**
 * OpenID4VP Wallet Conformance Tests
 *
 * Runs the OpenID Foundation Conformance Suite OID4VP wallet test plan.
 * The conformance suite acts as a verifier and the wallet must respond
 * to authorization requests.
 *
 * Prerequisites:
 *   - Conformance suite running
 *   - Wallet stack running with allow-all trust
 *   - VC services running (for credential pre-loading)
 *   - /etc/hosts entry: 127.0.0.1 localhost.emobix.co.uk
 */

import { test, expect } from '../../helpers/tenant-setup-fixture';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { ConformanceAPI, type TestState } from '../../helpers/conformance-api';
import { issueCredentialToWallet, isVCServicesAvailable } from '../../helpers/wallet-automation';
import { loginUserViaUI } from '../../helpers/ui-actions';
import { ENV } from '../../helpers/shared-helpers';
import { CREDENTIAL_TYPES } from '../../helpers/vc-services';
import { WebAuthnHelper } from '../../helpers/webauthn';

// =============================================================================
// Configuration
// =============================================================================

const CONFORMANCE_URL = process.env.CONFORMANCE_URL || 'https://localhost.emobix.co.uk:8443/';
const FRONTEND_URL = ENV.FRONTEND_URL;

const VP_VARIANTS = [
  {
    name: 'sd_jwt_vc / x509_san_dns / direct_post / request_uri_signed / plain_vp',
    variant: {
      credential_format: 'sd_jwt_vc',
      client_id_prefix: 'x509_san_dns',
      response_mode: 'direct_post',
      request_method: 'request_uri_signed',
      vp_profile: 'plain_vp',
    },
  },
  {
    name: 'sd_jwt_vc / x509_san_dns / direct_post.jwt / request_uri_signed / plain_vp',
    variant: {
      credential_format: 'sd_jwt_vc',
      client_id_prefix: 'x509_san_dns',
      response_mode: 'direct_post.jwt',
      request_method: 'request_uri_signed',
      vp_profile: 'plain_vp',
    },
  },
  {
    name: 'sd_jwt_vc / x509_san_dns / direct_post / request_uri_signed / haip',
    variant: {
      credential_format: 'sd_jwt_vc',
      client_id_prefix: 'x509_san_dns',
      response_mode: 'direct_post',
      request_method: 'request_uri_signed',
      vp_profile: 'haip',
    },
  },
  {
    name: 'sd_jwt_vc / redirect_uri / direct_post / request_uri_signed / plain_vp',
    variant: {
      credential_format: 'sd_jwt_vc',
      client_id_prefix: 'redirect_uri',
      response_mode: 'direct_post',
      request_method: 'request_uri_signed',
      vp_profile: 'plain_vp',
    },
  },
  {
    name: 'iso_mdl / x509_san_dns / direct_post / request_uri_signed / plain_vp',
    configPath: '../../configs/conformance/vp-wallet-mdoc-config.json',
    variant: {
      credential_format: 'iso_mdl',
      client_id_prefix: 'x509_san_dns',
      response_mode: 'direct_post',
      request_method: 'request_uri_signed',
      vp_profile: 'plain_vp',
    },
  },
];

const VP_PLAN_NAME = 'oid4vp-1final-wallet-test-plan';
const VP_DEFAULT_CONFIG_PATH = path.resolve(__dirname, '../../configs/conformance/vp-wallet-config.json');
const RESULTS_DIR = process.env.CONFORMANCE_RESULTS_DIR || path.resolve(__dirname, '../../conformance-results');

// =============================================================================
// Tests
// =============================================================================

test.describe('OID4VP Wallet Conformance Suite', () => {
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

  test.describe('VP Conformance Tests', () => {
    let credentialLoaded = false;

    test.beforeAll(async ({ browser, tenantContext }) => {
      if (!conformanceReady) return;
      if (!tenantContext.ready) return;

      const vcAvailable = await isVCServicesAvailable();
      if (!vcAvailable) {
        console.log('VC services not available - cannot pre-load credential for VP tests');
        return;
      }

      const page = await browser.newPage();
      try {
        const webauthn = new WebAuthnHelper(page);
        await webauthn.initialize();
        await webauthn.injectPrfMock();
        await webauthn.addPlatformAuthenticator();
        if (tenantContext.credentials) {
          for (const cred of tenantContext.credentials) {
            await webauthn.addCredential(cred);
          }
        }

        const loginResult = await loginUserViaUI(page, { tenantId: tenantContext.tenantId });
        if (!loginResult.success) {
          console.log('Login failed for credential pre-loading:', loginResult.error);
          return;
        }

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

        const dismissBtn = page.locator('button:has-text("Dismiss")');
        if (await dismissBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
          await dismissBtn.click();
          await page.waitForTimeout(1000);
        }

        console.log('Pre-loading PID credential from VC issuer...');
        const issueResult = await issueCredentialToWallet(page, CREDENTIAL_TYPES.PID_1_8);
        if (!issueResult.success) {
          console.log('Credential pre-loading failed:', issueResult.error);
          return;
        }
        credentialLoaded = true;
        console.log('PID credential successfully loaded into wallet');
      } finally {
        await page.close();
      }
    });

    test.beforeEach(async ({ tenantContext }) => {
      if (!tenantContext.ready) {
        test.skip(true, tenantContext.error || 'Tenant setup failed');
        return;
      }
    });

    for (const variantConfig of VP_VARIANTS) {
      test.describe(`Variant: ${variantConfig.name}`, () => {
        let planId: string;
        let planModules: string[];

        test.beforeAll(async () => {
          if (!conformanceReady) return;

          const configPath = variantConfig.configPath
            ? path.resolve(__dirname, variantConfig.configPath)
            : VP_DEFAULT_CONFIG_PATH;
          const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
          if (process.env.GITHUB_ACTOR) config.developer = process.env.GITHUB_ACTOR;
          if (process.env.GITHUB_SHA) config.description = `${config.description || ''} [${process.env.GITHUB_SHA.slice(0, 7)}]`.trim();
          const configJson = JSON.stringify(config);

          const plan = await api.createTestPlan(
            VP_PLAN_NAME,
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

        test('should pass all VP conformance modules', async ({ page, tenantContext }) => {
          test.setTimeout(300000);

          expect(planId).toBeDefined();
          expect(planModules.length).toBeGreaterThan(0);

          if (!credentialLoaded) {
            test.skip(true, 'No credential pre-loaded - VC services may not be available');
            return;
          }

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

          const welcomeDismiss = page.locator('button:has-text("Dismiss")');
          if (await welcomeDismiss.isVisible({ timeout: 3000 }).catch(() => false)) {
            await welcomeDismiss.click();
            await page.waitForTimeout(1000);
          }

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

            // Module is WAITING — get wallet interaction URL
            let interactionUrl = await api.getWalletInteractionUrl(moduleId);
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

              // Fetch redirect to capture openid4vp:// URL
              try {
                const response = await page.request.fetch(browserUrl, {
                  maxRedirects: 0,
                  ignoreHTTPSErrors: true,
                });
                const location = response.headers()['location'];
                if (location && (location.startsWith('openid4vp://') || location.includes('request_uri='))) {
                  interactionUrl = location;
                } else {
                  await page.goto(browserUrl, { waitUntil: 'networkidle', timeout: 15000 });
                }
              } catch {
                await page.goto(browserUrl, { waitUntil: 'networkidle', timeout: 15000 });
              }
            }

            if (interactionUrl) {
              console.log(`Module ${moduleName}: presenting credential via ${interactionUrl.slice(0, 80)}...`);

              const vpParams = interactionUrl.replace('openid4vp://?', '');
              const tenantBasePath = `/id/${tenantContext.tenantId}/`;

              await page.evaluate(({ basePath, params }) => {
                window.history.pushState(null, '', `${basePath}?${params}`);
                window.dispatchEvent(new PopStateEvent('popstate', { state: null }));
              }, { basePath: tenantBasePath, params: vpParams });

              try {
                await page.waitForURL((url) => url.pathname.includes('/cb'), { timeout: 10000 });
              } catch {
                console.log(`Module ${moduleName}: SPA navigation to /cb timed out`);
              }

              await page.waitForTimeout(5000);

              // Handle credential selection
              const nextBtn = page.locator('#next-select-credentials');
              if (await nextBtn.isVisible({ timeout: 10000 }).catch(() => false)) {
                console.log(`Module ${moduleName}: credential selection visible, proceeding...`);
                await nextBtn.click();
                await page.waitForTimeout(1000);

                const credCards = page.locator('[id^="slider-select-credentials-"]');
                const cardCount = await credCards.count();
                if (cardCount > 0) {
                  await credCards.first().click();
                  await page.waitForTimeout(500);
                  if (await nextBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
                    await nextBtn.click();
                    await page.waitForTimeout(1000);
                  }
                }

                const sendBtn = page.locator('#send-select-credentials');
                if (await sendBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
                  await sendBtn.click();
                  await page.waitForTimeout(3000);
                }
              }
            }

            // Wait for module to finish
            try {
              await api.waitForState(moduleId, ['FINISHED'], 60000);
            } catch {
              console.log(`Module ${moduleName} did not finish in time`);
            }

            const finalInfo = await api.getModuleInfo(moduleId);
            const { counts, failures } = await api.getModuleConditions(moduleId);
            console.log(`Module ${moduleName} result: ${finalInfo.result}`);
            console.log(`  Conditions: ${Object.entries(counts).map(([k,v]) => `${k}=${v}`).join(' ')}`);
            if (failures.length > 0) {
              failures.forEach(f => console.log(`  FAILURE [${f.src}]: ${f.msg}`));
            }

            results.push({
              module: moduleName,
              status: finalInfo.status,
              result: finalInfo.result,
              passed: finalInfo.result === 'PASSED',
              conditions: counts,
              failures,
            });

            // Navigate back to wallet home between modules
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
            profile: 'wallet-vp',
            plan: VP_PLAN_NAME,
            planId,
            variant: variantConfig.name,
            timestamp: new Date().toISOString(),
            planDetailUrl: api.getPlanDetailUrl(planId),
            total: results.length,
            passed: passed.length,
            failed: failed.length,
            modules: results,
            metadata: {
              targetRepo: process.env.TARGET_REPO || '',
              targetPr: process.env.TARGET_PR || '',
              runId: process.env.GITHUB_RUN_ID || '',
              actor: process.env.GITHUB_ACTOR || '',
              sha: process.env.GITHUB_SHA || '',
              ref: process.env.GITHUB_REF || '',
              images: {
                'wallet-frontend': process.env.WALLET_FRONTEND_IMAGE || '',
                'go-wallet-backend': process.env.WALLET_BACKEND_IMAGE || '',
                'go-trust': process.env.GO_TRUST_IMAGE || '',
              },
              goldenRelease: process.env.GOLDEN_RELEASE || '',
            },
          };
          fs.mkdirSync(RESULTS_DIR, { recursive: true });
          fs.writeFileSync(
            path.join(RESULTS_DIR, 'wallet-vp-summary.json'),
            JSON.stringify(summary, null, 2)
          );

          console.log('\n=== VP Wallet Conformance Results ===');

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
