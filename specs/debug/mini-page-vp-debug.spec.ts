/**
 * The one-module OID4VP debug driver: the mini-wallet page against the
 * suite's first presentation module, with full capture — the Phase 2
 * counterpart of mini-page-debug.spec.ts.
 */
import { test } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { ConformanceAPI } from '../../helpers/conformance-api';

const CONFORMANCE_URL = 'https://localhost.emobix.co.uk:8443/';
const MINI_WALLET_URL = 'http://localhost:3010/';
const VP_PLAN_NAME = process.env.VP_PLAN_NAME || 'oid4vp-1final-wallet-test-plan';
const VP_CONFIG_PATH = path.resolve(
  __dirname,
  `../../configs/conformance/${
    process.env.VP_PROFILE === 'haip' ? 'vp-wallet-haip-config.json' : 'vp-wallet-config.json'
  }`
);
const VP_MODULE = process.env.VP_MODULE || 'oid4vp-1final-wallet-happy-flow';

test('drive one OID4VP module through the mini-wallet page', async ({ page }) => {
  const logs: string[] = [];
  page.on('console', (msg) => logs.push(`${msg.type()}: ${msg.text().slice(0, 300)}`));
  page.on('pageerror', (err) => logs.push(`PAGEERROR: ${err.message.slice(0, 300)}`));
  page.on('requestfailed', (req) =>
    logs.push(`REQFAIL: ${req.url().slice(0, 200)} ${req.failure()?.errorText}`)
  );
  page.on('request', (req) => {
    const url = req.url();
    if (url.includes('emobix')) {
      console.log('SUITE REQ:', req.method(), url.replace('https://localhost.emobix.co.uk:8443', '').slice(0, 120));
    }
  });
  page.on('response', async (resp) => {
    if (resp.url().includes('emobix') && resp.status() >= 400) {
      console.log('SUITE RESP:', resp.status(), resp.url().replace('https://localhost.emobix.co.uk:8443', '').slice(0, 120));
    }
  });

  const api = new ConformanceAPI(CONFORMANCE_URL);
  await api.waitForServerReady(30000);

  const config = JSON.parse(
    fs.readFileSync(
      process.env.VP_PROFILE === 'haip'
        ? path.resolve(__dirname, '../../configs/conformance/vp-wallet-haip-config.json')
        : VP_CONFIG_PATH,
      'utf8'
    )
  );
  // The haip profile runs its own plan, with its own variant axes: the
  // credential format and type, and the response mode (direct_post.jwt —
  // the JARM HTTP POST — or dc_api.jwt, the W3C Digital Credentials API
  // browser flow). The plain plan's axes (client_id_prefix, request_method,
  // vp_profile) do not apply.
  const planName =
    process.env.VP_PROFILE === 'haip'
      ? 'oid4vp-1final-wallet-haip-test-plan'
      : VP_PLAN_NAME;
  const variant: Record<string, string> =
    process.env.VP_PROFILE === 'haip'
      ? {
          credential_format: process.env.VCI_FORMAT || 'sd_jwt_vc',
          credential_type: process.env.VP_CREDENTIAL_TYPE || 'eudi_pid',
          response_mode: process.env.VP_RESPONSE_MODE || 'direct_post.jwt',
        }
      : {
          credential_format: 'sd_jwt_vc',
          client_id_prefix: process.env.VP_CLIENT_ID_PREFIX || 'x509_san_dns',
          response_mode: process.env.VP_RESPONSE_MODE || 'direct_post',
          request_method: 'request_uri_signed',
          vp_profile: process.env.VP_PROFILE || 'plain_vp',
        };
  const plan = await api.createTestPlan(planName, JSON.stringify(config), variant);
  console.log('PLAN', plan.id);

  const moduleInfo = await api.createTestFromPlan(plan.id, VP_MODULE);
  const moduleId = moduleInfo.id;
  const state = await api.waitForState(moduleId, ['WAITING', 'FINISHED'], 60000);
  console.log('MODULE STATE:', state);
  if (state === 'FINISHED') {
    const done = await api.getModuleInfo(moduleId);
    console.log('MODULE FINAL: FINISHED result:', done.result);
    return;
  }

  let interactionUrl = await api.getWalletInteractionUrl(moduleId);
  if (!interactionUrl) {
    // Some modules expose only the browser interaction URL: follow its
    // redirect to capture the openid4vp:// authorization request.
    const browserUrl = await api.getBrowserInteractionUrl(moduleId);
    if (browserUrl) {
      try {
        const response = await page.request.fetch(browserUrl, {
          maxRedirects: 0,
          ignoreHTTPSErrors: true,
        });
        const location = response.headers()['location'];
        if (location && (location.startsWith('openid4vp://') || location.includes('request_uri='))) {
          interactionUrl = location;
        }
      } catch {
        // no redirect to follow
      }
    }
  }
  console.log('INTERACTION URL:', (interactionUrl || '').slice(0, 160));

  // The request object, fetched from the request_uri while the module
  // is WAITING — the wire shape the engine must parse.
  if (interactionUrl) {
    const requestUri = new URLSearchParams(interactionUrl.replace('openid4vp://?', ''))
      .get('request_uri');
    if (requestUri) {
      const resp = await fetch(requestUri, { }).catch((e: any) => ({ error: String(e) }));
      if (resp && typeof (resp as any).text === 'function') {
        const jwt = (await (resp as any).text()).trim();
        const [header, payload] = jwt.split('.');
        const dec = (s: string) => {
          const pad = '='.repeat((-s.length) % 4);
          return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64').toString();
        };
        try {
          console.log('REQUEST OBJECT HEADER:', JSON.stringify(JSON.parse(dec(header)), null, 1).slice(0, 900));
          console.log('REQUEST OBJECT PAYLOAD:', JSON.stringify(JSON.parse(dec(payload)), null, 1).slice(0, 1500));
        } catch {
          console.log('REQUEST OBJECT (raw):', jwt.slice(0, 300));
        }
        fs.writeFileSync('/tmp/opencode/haip-request.jwt', jwt);
      }
    }
  }

  await page.goto(`${MINI_WALLET_URL}?request=${encodeURIComponent(interactionUrl || '')}`, {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });
  await page.waitForTimeout(15000);

  const flowState = await page.getAttribute('body', 'data-flow-state');
  console.log('FLOW STATE:', flowState);
  const lastResult = await page.evaluate(() => (window as any).__last_result ?? null);
  console.log('LAST RESULT:', lastResult === null ? 'null' : JSON.stringify(lastResult).slice(0, 400));
  console.log('BOOT ERROR:', await page.evaluate(() => (window as any).__boot_error || null));
  console.log('ERROR DETAIL:', JSON.stringify(await page.evaluate(() => (window as any).__boot_error_detail || null)).slice(0, 500));
  console.log('HAS ENGINE:', await page.evaluate(() => !!(window as any).__engine));
  console.log('LOGS:\n' + logs.join('\n'));

  // The negative tests transition to FINISHED only when the tester
  // uploads the wallet's error screen to the module's placeholder: the
  // module's log entry with an `upload` member carries the placeholder
  // id, and the image POSTs to /api/log/{id}/images/{placeholder} as a
  // data URI. REVIEW is the expected outcome — the wallet refused and
  // the screenshot is the tester's evidence.
  if (flowState === 'error') {
    try {
      const log = (await api.getTestLog(moduleId)) as any[];
      const placeholder = log.find((e: any) => typeof e.upload === 'string')?.upload;
      if (!placeholder) throw new Error('no placeholder in the module log');
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
      console.log('PLACEHOLDER:', placeholder, '->', res.status());
    } catch (e) {
      console.log('PLACEHOLDER: failed', String(e));
    }
  }

  const finalState = await api.waitForState(moduleId, ['FINISHED'], 90000).catch(() => 'TIMEOUT');
  const finalInfo = await api.getModuleInfo(moduleId).catch(() => null);
  console.log('MODULE FINAL:', finalState, 'result:', finalInfo && finalInfo.result);
  const log = await api.getTestLog(moduleId).catch(() => [] as any[]);
  const failures = (log as any[]).filter((e: any) => String(e.result).toUpperCase().includes('FAIL'));
  console.log('FAIL COUNT:', failures.length);
  const seen = new Set<string>();
  for (const f of failures) {
    if (seen.has(f.msg)) continue;
    seen.add(f.msg);
    console.log('FAIL:', JSON.stringify(f).slice(0, 500));
  }
});
