/**
 * OpenID4VP Android Wallet Conformance Tests
 *
 * Runs the OpenID Foundation Conformance Suite OID4VP wallet test plan
 * against the Android sample-app via ADB deep-link dispatch.
 *
 * Prerequisites:
 *   - Conformance suite running
 *   - Waydroid running with sample-app installed
 *   - ADB connected to Waydroid
 *   - A credential pre-loaded in the wallet (run VCI test first or use issuer)
 *   - /etc/hosts entry: 127.0.0.1 localhost.emobix.co.uk
 *
 * Usage:
 *   ADB_WALLET=1 npx playwright test specs/conformance/oid4vp-android-wallet.spec.ts
 */

import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { ConformanceAPI, type TestState } from '../../helpers/conformance-api';
import { AdbWalletHelper } from '../../helpers/adb-wallet';
import { ENV } from '../../helpers/shared-helpers';

// =============================================================================
// Configuration
// =============================================================================

const CONFORMANCE_URL = process.env.CONFORMANCE_URL || 'https://localhost.emobix.co.uk:8443/';

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
];

const VP_PLAN_NAME = 'oid4vp-1final-wallet-test-plan';
const VP_CONFIG_PATH = path.resolve(__dirname, '../../configs/conformance/vp-wallet-config.json');
const RESULTS_DIR = process.env.CONFORMANCE_RESULTS_DIR || path.resolve(__dirname, '../../conformance-results');

// =============================================================================
// Tests
// =============================================================================

test.describe('OID4VP Android Wallet Conformance Suite', () => {
  const api = new ConformanceAPI(CONFORMANCE_URL);
  const adb = new AdbWalletHelper();
  let conformanceReady: boolean;
  let adbReady: boolean;

  test.beforeAll(async () => {
    try {
      await api.waitForServerReady(30000);
      conformanceReady = true;
    } catch (error) {
      console.log('Conformance suite not available:', (error as Error).message);
      conformanceReady = false;
    }

    try {
      await adb.connect();
      const installed = await adb.isAppInstalled();
      if (!installed) {
        console.log('Sample app not installed on device');
        adbReady = false;
      } else {
        adbReady = true;
      }
    } catch (error) {
      console.log('ADB not available:', (error as Error).message);
      adbReady = false;
    }
  });

  test.beforeEach(async () => {
    if (!conformanceReady) {
      test.skip(true, 'Conformance suite not available');
      return;
    }
    if (!adbReady) {
      test.skip(true, 'ADB / Android app not available');
      return;
    }
  });

  test.afterAll(async () => {
    await adb.cleanup();
  });

  test.describe('Credential Pre-loading', () => {
    test('should pre-load a PID credential via VCI', async () => {
      test.setTimeout(120000);

      // Use the SIROS VC issuer to issue a credential to the Android wallet.
      // This creates a credential offer and sends it via ADB.
      const { createCredentialOffer, CREDENTIAL_TYPES } = await import('../../helpers/vc-services');
      const { isVCServicesAvailable } = await import('../../helpers/wallet-automation');

      const vcAvailable = await isVCServicesAvailable();
      if (!vcAvailable) {
        test.skip(true, 'VC services not available for credential pre-loading');
        return;
      }

      const offer = await createCredentialOffer(CREDENTIAL_TYPES.PID_1_8, `android-${Date.now()}`);
      expect(offer.credential_offer_uri).toBeDefined();

      console.log(`Pre-loading credential via offer: ${offer.credential_offer_uri.slice(0, 80)}...`);

      await adb.clearLogcat();
      await adb.sendDeepLink(offer.credential_offer_uri);

      const result = await adb.waitForFlowCompletion(60000);
      console.log(`Pre-load result: ${result.success ? 'OK' : 'FAILED'} — ${result.message}`);
      expect(result.success).toBe(true);
    });
  });

  for (const variantConfig of VP_VARIANTS) {
    test.describe(`Variant: ${variantConfig.name}`, () => {
      let planId: string;
      let planModules: string[];

      test.beforeAll(async () => {
        if (!conformanceReady || !adbReady) return;

        const config = JSON.parse(fs.readFileSync(VP_CONFIG_PATH, 'utf-8'));
        if (process.env.GITHUB_ACTOR) config.developer = process.env.GITHUB_ACTOR;
        const configJson = JSON.stringify(config);

        const plan = await api.createTestPlan(VP_PLAN_NAME, configJson, variantConfig.variant);
        planId = plan.id;
        planModules = plan.modules.map((m) => m.testModule);

        console.log(`Created VP plan ${planId} with ${planModules.length} modules:`);
        planModules.forEach((m) => console.log(`  - ${m}`));

        await adb.launchApp();
      });

      test('should have created a test plan', () => {
        expect(planId).toBeDefined();
        expect(planModules.length).toBeGreaterThan(0);
      });

      test('should pass all VP conformance modules', async () => {
        test.setTimeout(300000);
        expect(planId).toBeDefined();
        expect(planModules.length).toBeGreaterThan(0);

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
            console.log(`Module ${moduleName} timed out: ${(error as Error).message}`);
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

          // Module is WAITING — get the VP interaction URL
          let interactionUrl = await api.getWalletInteractionUrl(moduleId);
          if (!interactionUrl) {
            // Try browser URL which may redirect to openid4vp://
            const browserUrl = await api.getBrowserInteractionUrl(moduleId);
            if (browserUrl) {
              // Fetch the redirect to get the openid4vp:// URL
              try {
                const resp = await fetch(browserUrl, {
                  redirect: 'manual',
                  headers: { Accept: 'text/html' },
                });
                const location = resp.headers.get('location');
                if (location && (location.startsWith('openid4vp://') || location.includes('request_uri='))) {
                  interactionUrl = location;
                }
              } catch {
                // Fall through
              }
            }
          }

          if (!interactionUrl) {
            console.log(`Module ${moduleName}: no interaction URL found`);
            results.push({ module: moduleName, status: 'ERROR', result: 'NO_URL', passed: false });
            continue;
          }

          console.log(`Module ${moduleName}: sending VP request to Android: ${interactionUrl.slice(0, 80)}...`);

          await adb.clearLogcat();
          await adb.sendDeepLink(interactionUrl);

          const flowResult = await adb.waitForFlowCompletion(60000);
          console.log(`Module ${moduleName}: flow ${flowResult.success ? 'completed' : 'failed'}: ${flowResult.message}`);

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
        }

        // Export results
        try {
          const reportPath = await api.exportPlanResults(planId, RESULTS_DIR);
          console.log(`\nConformance report exported: ${reportPath}`);
        } catch (e) {
          console.log('Report export failed:', (e as Error).message);
        }

        // Summary
        console.log('\n=== VP Android Wallet Results ===');
        const passed = results.filter((r) => r.passed).length;
        console.log(`Passed: ${passed}/${results.length}`);
        results
          .filter((r) => !r.passed)
          .forEach((r) => console.log(`  FAILED: ${r.module} (${r.result})`));

        const allLogs = await adb.getRecentLogs(200);
        if (results.some((r) => !r.passed)) {
          console.log('\n=== Recent Android Logs ===');
          console.log(allLogs);
        }

        expect(passed).toBe(results.length);
      });
    });
  }
});
