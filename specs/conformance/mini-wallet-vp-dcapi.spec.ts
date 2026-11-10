/**
 * Mini-wallet OID4VP Digital Credentials API Conformance — the raw
 * Rust engine core. The W3C DC API channel (OpenID4VP 1.0 §8.4): the
 * request arrives by value inside the browser API's payload, the
 * wallet never POSTs its answer back — the engine's flow completes
 * with the DigitalCredential's data and this spec plays the browser's
 * role, handing it to the module's browser API submit URL exactly as
 * the suite's own page does.
 *
 * The group: the haip plan's `x509_hash` / `request_uri_signed` /
 * `dc_api.jwt` module set — `eudi_pid` (sd_jwt_vc) on the HAIP profile.
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
const HAIP_PLAN_NAME = 'oid4vp-1final-wallet-haip-test-plan';
const HAIP_CONFIG_PATH = path.resolve(
  __dirname,
  '../../configs/conformance/vp-wallet-haip-config.json'
);
// The suite's browser page origin — the DC API caller the engine's
// §8.4 binding checks and the KB-JWT's aud name.
const ORIGIN = 'https://localhost.emobix.co.uk:8443';
// The three module groups of the haip plan's dc_api variant: the
// signed compact form, the unsigned web-origin form, and the
// multi-signed general JWS. The plan fixes the axes per module; the
// runner create resolves them from the override.
const GROUPS = [
  {
    name: 'x509_hash / request_uri_signed',
    variant: { client_id_prefix: 'x509_hash', request_method: 'request_uri_signed', vp_profile: 'haip' },
  },
  {
    name: 'web-origin / request_uri_unsigned',
    variant: { client_id_prefix: 'web-origin', request_method: 'request_uri_unsigned', vp_profile: 'haip' },
  },
  {
    name: 'x509_hash / request_uri_multisigned',
    variant: { client_id_prefix: 'x509_hash', request_method: 'request_uri_multisigned', vp_profile: 'haip' },
  },
];

test.describe('Mini-wallet (the raw Rust engine core) — OID4VP dc_api', () => {
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

  for (const group of GROUPS) {
    test.describe(`Group: ${group.name}`, () => {
      test('should pass the dc_api module group against the raw engine', async ({ page }) => {
    test.setTimeout(1_800_000);

    const config = JSON.parse(fs.readFileSync(HAIP_CONFIG_PATH, 'utf8'));
    const plan = await api.createTestPlan(HAIP_PLAN_NAME, JSON.stringify(config), {
      credential_format: 'sd_jwt_vc',
      credential_type: 'eudi_pid',
      response_mode: 'dc_api.jwt',
    });
    const planId = plan.id;
    // This group's modules (the plan fixes the axes per module).
    const planModules = plan.modules
      .filter((m: any) => {
        const v = m.variant || {};
        return (
          v.client_id_prefix === group.variant.client_id_prefix &&
          v.request_method === group.variant.request_method
        );
      })
      .map((m: any) => m.testModule);
    console.log(`[mini-wallet-vp-dcapi] plan ${planId} (${group.name}): ${planModules.length} modules`);

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
      const moduleInfo = await api.createTestFromPlanWithVariant(
        planId,
        moduleName,
        group.variant
      );
      const moduleId = moduleInfo.id;

      let state: TestState;
      try {
        state = await api.waitForState(moduleId, ['WAITING', 'FINISHED'], 60000);
      } catch {
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
          passed:
            info.result === 'PASSED' || info.result === 'SKIPPED' || info.result === 'REVIEW',
        });
        continue;
      }

      // The browser API request and the submit URL from the module's
      // log — the {digital: {requests: [...]}} payload the browser
      // delivers, and the URL the suite's own page posts the answer
      // to. Three protocols: the signed compact JWS (a text request),
      // the multisigned general JWS (an OBJECT with payload +
      // signatures), the unsigned web-origin form (the plain request
      // object as the data itself).
      const log = (await api.getTestLog(moduleId)) as any[];
      let requestJwt = '';
      let requestData: any = null;
      let protocol = '';
      let submitUrl = '';
      for (const entry of log) {
        if (entry.request?.digital?.requests) {
          const req = entry.request.digital.requests[0];
          protocol = req.protocol;
          requestJwt = typeof req.data.request === 'string'
            ? req.data.request
            : req.data.request
              ? JSON.stringify(req.data.request)
              : '';
          if (!requestJwt) requestData = req.data;
        }
        if (entry.browser_api_submit?.fullUrl) {
          submitUrl = entry.browser_api_submit.fullUrl;
        }
      }
      if ((!requestJwt && !requestData) || !submitUrl) {
        console.log(`${moduleName}: no browser API request or submit URL`);
        results.push({
          module: moduleName,
          status: 'ERROR',
          result: 'NO_REQUEST',
          passed: false,
        });
        continue;
      }

      // The mini-wallet page: the caller's origin beside the request —
      // the compact/multisigned JWS text by value (?request=), the
      // unsigned protocol's plain request object (?dcreq= base64url).
      const pageUrl = requestJwt
        ? `${MINI_WALLET_URL}?request=${encodeURIComponent(requestJwt)}&origin=${encodeURIComponent(ORIGIN)}`
        : `${MINI_WALLET_URL}?dcreq=${encodeURIComponent(
            Buffer.from(JSON.stringify(requestData)).toString('base64url')
          )}&origin=${encodeURIComponent(ORIGIN)}`;
      await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(8000);
      const flowState = await page.getAttribute('body', 'data-flow-state');
      console.log(`${moduleName}: flow ${flowState}`);

      // The response: the engine's wmp.flow.complete notification
      // carries the DigitalCredential's data (the page stores it
      // through its onNotification callback); the browser's role hands
      // it to the submit URL.
      const flowResult = await page.evaluate(() => (window as any).__flow_result ?? null);
      const dcApiData = flowResult?.dc_api_response ?? null;
      if (dcApiData) {
        const res = await page.request.fetch(submitUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          data: { protocol: protocol || 'openid4vp-v1-signed', data: dcApiData },
          failOnStatusCode: false,
          ignoreHTTPSErrors: true,
        });
        console.log(`${moduleName}: submit -> ${res.status()}`);
      } else if (flowState === 'error') {
        // The wallet refused: the browser API's promise rejects — the
        // suite's page posts the rejection, then the tester's
        // error-screen placeholder finishes the module.
        const errDetail = await page.evaluate(
          () => (window as any).__boot_error_detail || null
        );
        const reason = errDetail?.data?.reason || 'the wallet refused the request';
        const res = await page.request.fetch(submitUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          data: { exception: reason },
          failOnStatusCode: false,
          ignoreHTTPSErrors: true,
        });
        console.log(`${moduleName}: rejection submit -> ${res.status()}`);
        await page.waitForTimeout(5000);
        try {
          const logNow = (await api.getTestLog(moduleId)) as any[];
          const placeholder = logNow.find(
            (e: any) => typeof e.upload === 'string'
          )?.upload;
          if (placeholder) {
            const png =
              'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
            const up = await page.request.fetch(
              `${CONFORMANCE_URL}api/log/${moduleId}/images/${placeholder}`,
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'text/plain',
                  'Upload-Source': 'automated-test',
                },
                data: png,
                failOnStatusCode: false,
                ignoreHTTPSErrors: true,
              }
            );
            console.log(`${moduleName}: placeholder ${placeholder} -> ${up.status()}`);
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
      if (failures.length > 0) {
        failures.forEach((f: any) => console.log(`  FAILURE [${f.src}]: ${f.msg}`));
      }
      results.push({
        module: moduleName,
        status: finalInfo.status,
        result: finalInfo.result,
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
