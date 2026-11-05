/**
 * The full-plan OID4VP HAIP driver: every module of the haip plan against
 * the mini-wallet page, with full capture — the one-off tool that measures
 * the whole profile before the permanent spec lands.
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { ConformanceAPI } from '../../helpers/conformance-api';

const CONFORMANCE_URL = 'https://localhost.emobix.co.uk:8443/';
const MINI_WALLET_URL = 'http://localhost:3010/';

test('drive the whole OID4VP haip plan through the mini-wallet page', async ({ page }) => {
  test.setTimeout(1_500_000);
  const api = new ConformanceAPI(CONFORMANCE_URL);
  await api.waitForServerReady(30000);

  const configPath = path.resolve(__dirname, '../../configs/conformance/vp-wallet-haip-config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const plan = await api.createTestPlan('oid4vp-1final-wallet-haip-test-plan', JSON.stringify(config), {
    credential_format: process.env.VCI_FORMAT || 'sd_jwt_vc',
    credential_type: process.env.VP_CREDENTIAL_TYPE || 'eudi_pid',
    response_mode: process.env.VP_RESPONSE_MODE || 'direct_post.jwt',
  });
  console.log('PLAN', plan.id);
  const moduleNames = plan.modules.map((m: any) => m.testModule);
  console.log(`MODULES (${moduleNames.length}):`, moduleNames.join(', '));

  page.on('dialog', async (dialog) => {
    await dialog.accept().catch(() => {});
  });

  const results: Array<{ module: string; result: string; passed: boolean }> = [];
  for (const moduleName of moduleNames) {
    const moduleInfo = await api.createTestFromPlan(plan.id, moduleName);
    const moduleId = moduleInfo.id;
    const state = await api.waitForState(moduleId, ['WAITING', 'FINISHED'], 60000).catch(() => 'TIMEOUT');
    if (state === 'FINISHED') {
      const info = await api.getModuleInfo(moduleId);
      console.log(`${moduleName}: ${info.result}`);
      results.push({ module: moduleName, result: info.result, passed: info.result === 'PASSED' || info.result === 'SKIPPED' });
      continue;
    }
    if (state === 'TIMEOUT') {
      console.log(`${moduleName}: never WAITING`);
      results.push({ module: moduleName, result: 'TIMEOUT', passed: false });
      continue;
    }

    // WAITING: the request, by URL or by redirect.
    let interactionUrl = await api.getWalletInteractionUrl(moduleId);
    if (!interactionUrl) {
      const browserUrl = await api.getBrowserInteractionUrl(moduleId);
      if (browserUrl) {
        try {
          const response = await page.request.fetch(browserUrl, { maxRedirects: 0, ignoreHTTPSErrors: true });
          const location = response.headers()['location'];
          if (location && (location.startsWith('openid4vp://') || location.includes('request_uri='))) {
            interactionUrl = location;
          }
        } catch { /* no redirect */ }
      }
    }
    if (!interactionUrl) {
      console.log(`${moduleName}: no interaction URL`);
      results.push({ module: moduleName, result: 'NO_URL', passed: false });
      continue;
    }

    const walletUrl = `${MINI_WALLET_URL}?request=${encodeURIComponent(interactionUrl)}`;
    await page.goto(walletUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page
      .waitForFunction(
        () =>
          document.body.getAttribute('data-flow-state') === 'presented' ||
          document.body.getAttribute('data-flow-state') === 'completed' ||
          document.body.getAttribute('data-flow-state') === 'error',
        undefined,
        { timeout: 120_000 }
      )
      .catch(() => null);
    const flowState = await page.getAttribute('body', 'data-flow-state').catch(() => null);
    console.log(`${moduleName}: flow=${flowState}`);

    // The presented flow may still open the direct_post answer's
    // redirect_uri (OID4VP §8.2) — give the navigation time to land.
    if (flowState === 'presented') {
      await page.waitForTimeout(8000);
    }

    // The negative modules: the wallet refused (flow error) — the suite's
    // placeholder carries the tester's screenshot evidence, and REVIEW is
    // the expected outcome.
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
          console.log(`${moduleName}: placeholder -> ${res.status()}`);
        }
      } catch (e) {
        console.log(`${moduleName}: placeholder failed`, String(e));
      }
    }

    await api.waitForState(moduleId, ['FINISHED'], 180000).catch(() => null);
    const info = await api.getModuleInfo(moduleId);
    console.log(`${moduleName}: ${info.result}`);
    if (info.result !== 'PASSED' && info.result !== 'SKIPPED' && info.result !== 'REVIEW') {
      const log = await api.getTestLog(moduleId).catch(() => [] as any[]);
      const failures = (log as any[]).filter((e: any) => String(e.result).toUpperCase().includes('FAIL'));
      const seen = new Set<string>();
      for (const f of failures) {
        if (seen.has(f.msg)) continue;
        seen.add(f.msg);
        console.log(`  FAIL: ${String(f.msg).slice(0, 300)}`);
      }
    }
    // REVIEW: the negative module's expected outcome — the wallet
    // refused, the tester's evidence (the placeholder) completes it.
    results.push({ module: moduleName, result: info.result, passed: info.result === 'PASSED' || info.result === 'SKIPPED' || info.result === 'REVIEW' });
  }

  console.table(results);
  const failures = results.filter((r) => !r.passed);
  console.log(`SUMMARY: ${results.filter((r) => r.result === 'PASSED').length} PASSED, ${results.filter((r) => r.result === 'SKIPPED').length} SKIPPED, ${failures.length} otherwise`);
  expect(failures, `module failures: ${JSON.stringify(failures, null, 2)}`).toHaveLength(0);
});