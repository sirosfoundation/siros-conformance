/**
 * OpenID4VP Verifier/RP Conformance Tests
 *
 * Runs the OpenID Foundation Conformance Suite OID4VP RP test plan.
 * The conformance suite acts as a wallet and tests our VC verifier's
 * compliance with OpenID4VP.
 *
 * Prerequisites:
 *   - Conformance suite running
 *   - VC services running (verifier, registry)
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

const VERIFIER_CONFORMANCE_URL =
  process.env.VERIFIER_CONFORMANCE_URL || 'http://vc-verifier:8080';

const VERIFIER_HOST_URL = VC_ENV.VC_VERIFIER_URL;

const VP_VERIFIER_VARIANTS = [
  {
    name: 'sd_jwt_vc / x509_san_dns / direct_post / request_uri_signed',
    variant: {
      credential_format: 'sd_jwt_vc',
      client_id_prefix: 'x509_san_dns',
      response_mode: 'direct_post',
      request_method: 'request_uri_signed',
    },
  },
];

const VP_RP_PLAN_NAME = 'oid4vp-1final-rp-test-plan';

const VP_VERIFIER_CONFIG_PATH = path.resolve(
  __dirname,
  '../../configs/conformance/vp-verifier-config.json'
);

const RESULTS_DIR = process.env.CONFORMANCE_RESULTS_DIR || path.resolve(__dirname, '../../conformance-results');

// =============================================================================
// Helpers
// =============================================================================

function loadVerifierConfig(): string {
  let config = fs.readFileSync(VP_VERIFIER_CONFIG_PATH, 'utf-8');
  const discoveryUrl = `${VERIFIER_CONFORMANCE_URL}/.well-known/openid-configuration`;
  const resourceUrl = VERIFIER_CONFORMANCE_URL;
  config = config.replace(/\$\{VERIFIER_DISCOVERY_URL\}/g, discoveryUrl);
  config = config.replace(/\$\{VERIFIER_RESOURCE_URL\}/g, resourceUrl);
  return config;
}

// =============================================================================
// Tests
// =============================================================================

test.describe('OID4VP Verifier/RP Conformance Suite', () => {
  const api = new ConformanceAPI(CONFORMANCE_URL);
  let conformanceReady = false;
  let verifierReady = false;

  test.beforeAll(async () => {
    try {
      await api.waitForServerReady(30000);
      conformanceReady = true;
    } catch (error) {
      console.log('Conformance suite not available:', (error as Error).message);
    }

    try {
      const health = await checkVCServicesHealth();
      verifierReady = health.verifier;
      if (!verifierReady) {
        console.log('VC verifier not available');
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
    if (!verifierReady) {
      test.skip(true, 'VC verifier not available');
      return;
    }
  });

  for (const variantConfig of VP_VERIFIER_VARIANTS) {
    test.describe(`Variant: ${variantConfig.name}`, () => {
      let planId: string;
      let planModules: string[];

      test.beforeAll(async () => {
        if (!conformanceReady || !verifierReady) return;

        const configJson = loadVerifierConfig();
        console.log(
          `Creating verifier test plan with config targeting: ${VERIFIER_CONFORMANCE_URL}`
        );

        const plan = await api.createTestPlan(
          VP_RP_PLAN_NAME,
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

      test('should pass all verifier conformance modules', async ({ page }) => {
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
          console.log(`\n=== Running verifier module: ${moduleName} ===`);

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

          // Module is WAITING — trigger verification at our verifier
          console.log(`Module ${moduleName}: triggering verification request`);
          try {
            const response = await fetch(
              `${VERIFIER_HOST_URL}/authorize?` +
                new URLSearchParams({
                  response_type: 'vp_token',
                  client_id: 'e2e-test-client',
                  redirect_uri: 'http://localhost:3000/cb',
                  scope: 'pid',
                  nonce: `conformance-${Date.now()}`,
                  state: `state-${Date.now()}`,
                }),
              { redirect: 'manual' }
            );

            const location = response.headers.get('location');
            if (location) {
              console.log(`Module ${moduleName}: verifier redirected to ${location.slice(0, 100)}`);
            }
          } catch (error) {
            console.log(`Module ${moduleName}: failed to trigger verification: ${(error as Error).message}`);
          }

          try {
            await api.waitForState(moduleId, ['FINISHED'], 60000);
          } catch {
            console.log(`Module ${moduleName} did not finish in time`);
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
        console.log('\n=== Verifier Conformance Results ===');
        const passed = results.filter((r) => r.passed);
        const failed = results.filter((r) => !r.passed);

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
          `${failed.length} verifier modules failed: ${failed.map((r) => r.module).join(', ')}`
        ).toBe(0);
      });
    });
  }
});
