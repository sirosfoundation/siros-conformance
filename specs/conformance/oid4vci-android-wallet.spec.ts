/**
 * OpenID4VCI Android Wallet Conformance Tests
 *
 * Runs the OpenID Foundation Conformance Suite OID4VCI wallet test plan
 * against the Android sample-app via ADB deep-link dispatch.
 *
 * Instead of driving a browser via Playwright, this spec sends
 * `openid-credential-offer://` intents to the sample-app running
 * on Waydroid and monitors logcat for flow completion.
 *
 * Prerequisites:
 *   - Conformance suite running
 *   - Waydroid running with sample-app installed
 *   - ADB connected to Waydroid
 *   - /etc/hosts entry: 127.0.0.1 localhost.emobix.co.uk
 *   - Wallet backend running (for issuer registration)
 *
 * Usage:
 *   ADB_WALLET=1 npx playwright test specs/conformance/oid4vci-android-wallet.spec.ts
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
const TENANT_ID = process.env.ADB_TENANT_ID || 'default';

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

test.describe('OID4VCI Android Wallet Conformance Suite', () => {
  const api = new ConformanceAPI(CONFORMANCE_URL);
  const adb = new AdbWalletHelper();
  let conformanceReady: boolean;
  let adbReady: boolean;

  test.beforeAll(async () => {
    // Check conformance suite
    try {
      await api.waitForServerReady(30000);
      conformanceReady = true;
    } catch (error) {
      console.log('Conformance suite not available:', (error as Error).message);
      conformanceReady = false;
    }

    // Check ADB / Android app
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

  for (const variantConfig of VCI_VARIANTS) {
    test.describe(`Variant: ${variantConfig.name}`, () => {
      let planId: string;
      let planModules: string[];

      test.beforeAll(async () => {
        if (!conformanceReady || !adbReady) return;

        const config = JSON.parse(fs.readFileSync(VCI_CONFIG_PATH, 'utf-8'));
        if (process.env.GITHUB_ACTOR) config.developer = process.env.GITHUB_ACTOR;
        const configJson = JSON.stringify(config);

        const plan = await api.createTestPlan(VCI_PLAN_NAME, configJson, variantConfig.variant);
        planId = plan.id;
        planModules = plan.modules.map((m) => m.testModule);

        console.log(`Created VCI plan ${planId} with ${planModules.length} modules:`);
        planModules.forEach((m) => console.log(`  - ${m}`));

        // Register conformance issuer with wallet-backend
        const conformanceIssuerUrl =
          CONFORMANCE_URL.replace(/\/$/, '') + '/test/a/' + (config.alias || 'siros-wallet-vci-test') + '/';
        const clientId = config.client?.client_id || 'siros-wallet-test';
        const clientKeyWithPrivate =
          config.client?.private_key || config.client?.jwks?.keys?.find((k: any) => k.d);
        const clientPrivateKeyJwk = clientKeyWithPrivate ? JSON.stringify(clientKeyWithPrivate) : null;

        const resp = await fetch(`${ENV.ADMIN_URL}/admin/tenants/${TENANT_ID}/issuers`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${ENV.ADMIN_TOKEN}`,
          },
          body: JSON.stringify({
            credential_issuer_identifier: conformanceIssuerUrl,
            client_id: clientId,
            client_jwk: clientPrivateKeyJwk,
            visible: true,
          }),
        });
        console.log(`Registered conformance issuer: ${resp.status} (client_id=${clientId})`);

        // Launch the app fresh
        await adb.launchApp();
      });

      test('should have created a test plan', () => {
        expect(planId).toBeDefined();
        expect(planModules.length).toBeGreaterThan(0);
      });

      test('should pass all VCI conformance modules', async () => {
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

          // Module is WAITING — get the credential offer URL
          const interactionUrl = await api.getWalletInteractionUrl(moduleId);
          if (!interactionUrl) {
            console.log(`Module ${moduleName}: no interaction URL found`);
            results.push({ module: moduleName, status: 'ERROR', result: 'NO_URL', passed: false });
            continue;
          }

          console.log(`Module ${moduleName}: sending offer to Android app: ${interactionUrl.slice(0, 80)}...`);

          // Clear logcat before sending the intent
          await adb.clearLogcat();

          // Send the deep link to the Android app
          await adb.sendDeepLink(interactionUrl);

          // Wait for the SDK to process the flow
          const flowResult = await adb.waitForFlowCompletion(60000);
          console.log(`Module ${moduleName}: flow ${flowResult.success ? 'completed' : 'failed'}: ${flowResult.message}`);

          // Wait for conformance suite to finish evaluating
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
        console.log('\n=== VCI Android Wallet Results ===');
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
