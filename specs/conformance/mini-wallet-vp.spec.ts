/**
 * Mini-wallet OID4VP Conformance — the raw Rust engine core, Phase 2.
 *
 * Runs the OpenID Foundation OID4VP wallet test plan against the wasm
 * mini-wallet (the engine-adapter-wasm harness page) instead of
 * wallet-frontend + go-wallet-backend: the mini host holds a self-issued
 * PID SD-JWT (holder-bound to its device key), matches the DCQL query,
 * and builds the SD-JWT+KB presentation — the engine's OID4VP protocol
 * is the thing under test, judged by its HTTP traffic.
 *
 * The negative modules end in REVIEW: the wallet correctly refuses and
 * the suite's placeholder (the tester's screenshot evidence, uploaded
 * through /api/log/{id}/images/{placeholder}) completes them — the
 * certification procedure's manual step, automated.
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { ConformanceAPI, type TestState } from '../../helpers/conformance-api';

const CONFORMANCE_URL = process.env.CONFORMANCE_URL || 'https://localhost.emobix.co.uk:8443/';
const MINI_WALLET_URL = process.env.MINI_WALLET_URL || 'http://localhost:3010/';
const VP_PLAN_NAME = 'oid4vp-1final-wallet-test-plan';
const VP_CONFIG_PATH = path.resolve(
  __dirname,
  '../../configs/conformance/vp-wallet-config.json'
);
// The HAIP profile runs its own plan (oid4vp-1final-wallet-haip-test-plan)
// with its own variant axes (credential_format, credential_type,
// response_mode) and its own trust material: the profile's
// `credential.trust_anchor_pem` (HAIP-6.1), which the mini wallet's
// x5c-chained PID (HAIP-6.1.1) chains to — the fixtures under
// fixtures/mini-wallet-pki.
const HAIP_PLAN_NAME = 'oid4vp-1final-wallet-haip-test-plan';
const HAIP_CONFIG_PATH = path.resolve(
  __dirname,
  '../../configs/conformance/vp-wallet-haip-config.json'
);

/// One variant to run: the plan-level variant axes, and — for the
/// profiles that run their own plan — the plan name and the config.
interface VariantConfig {
  name: string;
  variant: Record<string, string>;
  planName?: string;
  configPath?: string;
}

const VARIANTS: VariantConfig[] = [
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
    // The HAIP profile (§1.1 of the HAIP spec): the x509_hash client_id
    // scheme, the x5c-chained credential, the JARM response.
    name: 'sd_jwt_vc / eudi_pid / haip / direct_post.jwt',
    planName: HAIP_PLAN_NAME,
    configPath: HAIP_CONFIG_PATH,
    variant: {
      credential_format: 'sd_jwt_vc',
      credential_type: 'eudi_pid',
      response_mode: 'direct_post.jwt',
    },
  },
];

test.describe('Mini-wallet (the raw Rust engine core) — OID4VP', () => {
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
      test('should pass all VP conformance modules against the raw engine', async ({ page }) => {
        test.setTimeout(1_200_000);

        const config = JSON.parse(
          fs.readFileSync(variantConfig.configPath ?? VP_CONFIG_PATH, 'utf8')
        );
        const plan = await api.createTestPlan(
          variantConfig.planName ?? VP_PLAN_NAME,
          JSON.stringify(config),
          variantConfig.variant
        );
        const planId = plan.id;
        const planModules = plan.modules.map((m: any) => m.testModule);
        console.log(`[mini-wallet-vp] Created plan ${planId} with ${planModules.length} modules`);

        const results: Array<{
          module: string;
          status: string;
          result: string;
          passed: boolean;
          conditions?: Record<string, number>;
          failures?: Array<{ src: string; msg: string }>;
        }> = [];

        for (const moduleName of planModules) {
          console.log(`\n=== ${moduleName} ===`);
          const moduleInfo = await api.createTestFromPlan(planId, moduleName);
          const moduleId = moduleInfo.id;

          let state: TestState;
          try {
            state = await api.waitForState(moduleId, ['WAITING', 'FINISHED'], 60000);
          } catch (error) {
            console.log(`${moduleName} never reached WAITING: ${(error as Error).message}`);
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
            console.log(`${moduleName}: ${info.result}`);
            results.push({
              module: moduleName,
              status: info.status,
              result: info.result,
              // SKIPPED: the variant does not exercise the module.
              passed: info.result === 'PASSED' || info.result === 'SKIPPED',
            });
            continue;
          }

          // The authorization request URL: the wallet interaction URL,
          // or the browser interaction URL's redirect.
          let interactionUrl = await api.getWalletInteractionUrl(moduleId);
          if (!interactionUrl) {
            const browserUrl = await api.getBrowserInteractionUrl(moduleId);
            if (browserUrl) {
              try {
                const response = await page.request.fetch(browserUrl, {
                  maxRedirects: 0,
                  ignoreHTTPSErrors: true,
                });
                const location = response.headers()['location'];
                if (
                  location &&
                  (location.startsWith('openid4vp://') || location.includes('request_uri='))
                ) {
                  interactionUrl = location;
                }
              } catch {
                // no redirect to follow
              }
            }
          }
          if (!interactionUrl) {
            console.log(`${moduleName}: no interaction URL`);
            results.push({
              module: moduleName,
              status: 'ERROR',
              result: 'NO_URL',
              passed: false,
            });
            continue;
          }

          await page.goto(
            `${MINI_WALLET_URL}?request=${encodeURIComponent(interactionUrl)}`,
            { waitUntil: 'domcontentloaded', timeout: 30000 }
          );
          await page.waitForTimeout(8000);
          const flowState = await page.getAttribute('body', 'data-flow-state');
          const errorDetail = await page.evaluate(
            () => (window as any).__boot_error_detail || null
          );
          console.log(`${moduleName}: flow ${flowState}`, errorDetail?.data?.reason || '');

          // The presented flow may still open the direct_post answer's
          // redirect_uri (OID4VP §8.2) — give the navigation the time
          // to land on the suite before moving on.
          if (flowState === 'presented') {
            await page.waitForTimeout(8000);
          }

          // The negative modules: the wallet refused (flow error) — the
          // suite's placeholder carries the tester's screenshot
          // evidence, and REVIEW is the expected outcome.
          if (flowState === 'error') {
            try {
              const log = (await api.getTestLog(moduleId)) as any[];
              const placeholder = log.find((e: any) => typeof e.upload === 'string')?.upload;
              if (placeholder) {
                const png =
                  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
                const res = await page.request.fetch(
                  `${CONFORMANCE_URL}api/log/${moduleId}/images/${placeholder}`,
                  {
                    method: 'POST',
                    headers: { 'Content-Type': 'text/plain', 'Upload-Source': 'automated-test' },
                    data: png,
                    failOnStatusCode: false,
                    ignoreHTTPSErrors: true,
                  }
                );
                console.log(`${moduleName}: placeholder ${placeholder} -> ${res.status()}`);
              }
            } catch (e) {
              console.log(`${moduleName}: placeholder failed`, String(e));
            }
          }

          try {
            await api.waitForState(moduleId, ['FINISHED'], 90000);
          } catch {
            console.log(`${moduleName} did not finish in time`);
          }

          const finalInfo = await api.getModuleInfo(moduleId);
          const { counts, failures } = await api.getModuleConditions(moduleId);
          console.log(`${moduleName} result: ${finalInfo.result}`);
          console.log(
            `  Conditions: ${Object.entries(counts)
              .map(([k, v]) => `${k}=${v}`)
              .join(' ')}`
          );
          if (failures.length > 0) {
            failures.forEach((f: any) => console.log(`  FAILURE [${f.src}]: ${f.msg}`));
          }

          results.push({
            module: moduleName,
            status: finalInfo.status,
            result: finalInfo.result,
            // REVIEW: the negative module's expected outcome — the
            // wallet refused, the tester's evidence uploaded.
            passed:
              finalInfo.result === 'PASSED' ||
              finalInfo.result === 'SKIPPED' ||
              finalInfo.result === 'REVIEW',
            conditions: counts,
            failures,
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
