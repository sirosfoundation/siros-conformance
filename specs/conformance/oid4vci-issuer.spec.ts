/**
 * OpenID4VCI Issuer Conformance Tests
 *
 * Runs the OpenID Foundation Conformance Suite OID4VCI issuer test plan.
 * The conformance suite acts as a wallet and tests our VC issuer's
 * compliance with OpenID4VCI.
 *
 * Prerequisites:
 *   - Conformance suite running
 *   - VC services running (issuer, apigw, mockas, registry)
 *   - /etc/hosts entry: 127.0.0.1 localhost.emobix.co.uk
 */

import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { ConformanceAPI, type TestState } from '../../helpers/conformance-api';
import { VC_ENV, checkVCServicesHealth } from '../../helpers/vc-services';

// =============================================================================
// Configuration
// =============================================================================

const CONFORMANCE_URL = process.env.CONFORMANCE_URL || 'https://localhost.emobix.co.uk:8443/';

const ISSUER_CONFORMANCE_URL =
  process.env.ISSUER_CONFORMANCE_URL || 'http://vc-apigw:8080';

const VCI_ISSUER_VARIANTS = [
  {
    name: 'sd_jwt_vc / pre-authorized_code / immediate',
    variant: {
      credential_format: 'sd_jwt_vc',
      vci_grant_type: 'pre_authorization_code',
      vci_credential_issuance_mode: 'immediate',
      sender_constrain: 'dpop',
      fapi_profile: 'vci',
    },
  },
  {
    name: 'sd_jwt_vc / authorization_code / immediate',
    variant: {
      credential_format: 'sd_jwt_vc',
      vci_grant_type: 'authorization_code',
      vci_credential_issuance_mode: 'immediate',
      sender_constrain: 'dpop',
      fapi_profile: 'vci',
    },
  },
];

const VCI_ISSUER_PLAN_NAME = 'oid4vci-1_0-issuer-test-plan';

const VCI_ISSUER_CONFIG_PATH = path.resolve(
  __dirname,
  '../../configs/conformance/vci-issuer-config.json'
);

const RESULTS_DIR = process.env.CONFORMANCE_RESULTS_DIR || path.resolve(__dirname, '../../conformance-results');

// =============================================================================
// Helpers
// =============================================================================

function loadIssuerConfig(): string {
  let config = fs.readFileSync(VCI_ISSUER_CONFIG_PATH, 'utf-8');
  const discoveryUrl = `${ISSUER_CONFORMANCE_URL}/.well-known/openid-credential-issuer`;
  const resourceUrl = ISSUER_CONFORMANCE_URL;
  config = config.replace(/\$\{ISSUER_DISCOVERY_URL\}/g, discoveryUrl);
  config = config.replace(/\$\{ISSUER_RESOURCE_URL\}/g, resourceUrl);
  return config;
}

// =============================================================================
// Tests
// =============================================================================

test.describe('OID4VCI Issuer Conformance Suite', () => {
  const api = new ConformanceAPI(CONFORMANCE_URL);
  let conformanceReady = false;
  let issuerReady = false;

  test.beforeAll(async () => {
    try {
      await api.waitForServerReady(30000);
      conformanceReady = true;
    } catch (error) {
      console.log('Conformance suite not available:', (error as Error).message);
    }

    try {
      const health = await checkVCServicesHealth();
      issuerReady = health.issuer && health.apigw;
      if (!issuerReady) {
        console.log('VC issuer/apigw not available');
      }
    } catch (error) {
      console.log('VC services health check failed:', (error as Error).message);
    }
  });

  test.beforeEach(async () => {
    if (!conformanceReady) {
      test.skip(true, 'Conformance suite not available');
      return;
    }
    if (!issuerReady) {
      test.skip(true, 'VC issuer services not available');
      return;
    }
  });

  for (const variantConfig of VCI_ISSUER_VARIANTS) {
    test.describe(`Variant: ${variantConfig.name}`, () => {
      let planId: string;
      let planModules: string[];

      test.beforeAll(async () => {
        if (!conformanceReady || !issuerReady) return;

        const configJson = loadIssuerConfig();
        console.log(`Creating issuer test plan with config targeting: ${ISSUER_CONFORMANCE_URL}`);

        const plan = await api.createTestPlan(
          VCI_ISSUER_PLAN_NAME,
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

      test('should pass all issuer conformance modules', async ({ page }) => {
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
          console.log(`\n=== Running issuer module: ${moduleName} ===`);

          const moduleInfo = await api.createTestFromPlan(planId, moduleName);
          const moduleId = moduleInfo.id;
          console.log(`Module ${moduleName} created: ${moduleId}`);

          let state: TestState;
          try {
            state = await api.waitForState(moduleId, ['WAITING', 'FINISHED'], 120000);
          } catch (error) {
            console.log(`Module ${moduleName} timed out: ${(error as Error).message}`);
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
            console.log(`Module ${moduleName} finished: ${info.result}`);
            results.push({
              module: moduleName,
              status: info.status,
              result: info.result,
              passed: info.result === 'PASSED',
            });
            continue;
          }

          // Module is WAITING — browser interaction needed (auth code flow)
          const browserUrl = await api.getBrowserInteractionUrl(moduleId);
          if (browserUrl) {
            console.log(`Module ${moduleName}: browser interaction at ${browserUrl.slice(0, 100)}`);

            await page.goto(browserUrl, { waitUntil: 'networkidle', timeout: 30000 });
            await page.waitForTimeout(3000);

            // Handle mock AS login form if present
            const loginInput = page.locator('input[name="username"], input[type="text"]').first();
            if (await loginInput.isVisible({ timeout: 3000 }).catch(() => false)) {
              console.log(`Module ${moduleName}: filling mock AS login form`);
              await loginInput.fill('test-user-001');
              const submitBtn = page.locator('button[type="submit"], input[type="submit"]').first();
              if (await submitBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
                await submitBtn.click();
                await page.waitForTimeout(3000);
              }
            }

            // Handle consent/approve button
            const approveBtn = page.locator(
              'button:has-text("Approve"), button:has-text("Allow"), button:has-text("Authorize")'
            ).first();
            if (await approveBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
              console.log(`Module ${moduleName}: clicking approve`);
              await approveBtn.click();
              await page.waitForTimeout(3000);
            }
          } else {
            console.log(`Module ${moduleName}: WAITING but no browser URL found`);
          }

          try {
            await api.waitForState(moduleId, ['FINISHED'], 60000);
          } catch {
            console.log(`Module ${moduleName} did not finish in time after interaction`);
          }

          const finalInfo = await api.getModuleInfo(moduleId);
          console.log(`Module ${moduleName} result: ${finalInfo.result}`);

          if (finalInfo.result !== 'PASSED') {
            try {
              const logs = await api.getTestLog(moduleId);
              const failures = logs.filter(
                (l) => l.result === 'FAILURE' || l.result === 'WARNING'
              );
              if (failures.length > 0) {
                console.log(`Module ${moduleName} failure details:`);
                for (const f of failures.slice(0, 5)) {
                  console.log(`  [${f.result}] ${f.src}: ${(f.msg || '').slice(0, 300)}`);
                }
              }
            } catch { /* best-effort */ }
          }

          results.push({
            module: moduleName,
            status: finalInfo.status,
            result: finalInfo.result,
            passed: finalInfo.result === 'PASSED',
          });
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
          profile: 'issuer',
          plan: VCI_ISSUER_PLAN_NAME,
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
          path.join(RESULTS_DIR, 'issuer-summary.json'),
          JSON.stringify(summary, null, 2)
        );

        console.log('\n=== Issuer Conformance Results ===');

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

        expect(
          failed.length,
          `${failed.length} issuer modules failed: ${failed.map((r) => r.module).join(', ')}`
        ).toBe(0);
      });
    });
  }
});
