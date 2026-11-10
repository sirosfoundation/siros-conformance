/**
 * The one-module OID4VP Digital Credentials API debug driver: the
 * mini-wallet page answers a dc_api request and the harness plays the
 * browser's role — the response returns through the module's browser
 * API submit URL, exactly as the suite's own page does (the
 * navigator.credentials.get emulation's postResult).
 *
 * The engine never POSTs for dc_api/dc_api.jwt (OpenID4VP 1.0 §8.4):
 * the flow completes with the DigitalCredential's data and this driver
 * hands it to the submit URL.
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
const HAIP_PLAN_NAME = 'oid4vp-1final-wallet-haip-test-plan';
const HAIP_CONFIG_PATH = path.resolve(
  __dirname,
  '../../configs/conformance/vp-wallet-haip-config.json'
);
const VP_MODULE = process.env.VP_MODULE || 'oid4vp-1final-wallet-happy-flow';
// The module group's variant axes (the plan fixes them per module;
// the runner create resolves them from this override).
const MODULE_VARIANT = {
  client_id_prefix: process.env.VP_CLIENT_ID_PREFIX || 'x509_hash',
  request_method: process.env.VP_REQUEST_METHOD || 'request_uri_signed',
  vp_profile: 'haip',
};

test('drive one dc_api module through the mini-wallet page', async ({ page }) => {
  const logs: string[] = [];
  page.on('console', (msg) => logs.push(`${msg.type()}: ${msg.text().slice(0, 300)}`));
  page.on('pageerror', (err) => logs.push(`PAGEERROR: ${err.message.slice(0, 300)}`));
  page.on('response', async (resp) => {
    if (resp.url().includes('emobix') && resp.status() >= 400) {
      console.log('SUITE RESP:', resp.status(), resp.url().replace('https://localhost.emobix.co.uk:8443', '').slice(0, 120));
    }
  });

  const api = new ConformanceAPI(CONFORMANCE_URL);
  await api.waitForServerReady(30000);

  const config = JSON.parse(fs.readFileSync(HAIP_CONFIG_PATH, 'utf8'));
  const plan = await api.createTestPlan(HAIP_PLAN_NAME, JSON.stringify(config), {
    credential_format: 'sd_jwt_vc',
    credential_type: 'eudi_pid',
    response_mode: process.env.VP_RESPONSE_MODE || 'dc_api.jwt',
  });
  console.log('PLAN', plan.id);

  const moduleInfo = await api.createTestFromPlanWithVariant(
    plan.id,
    VP_MODULE,
    MODULE_VARIANT
  );
  const moduleId = moduleInfo.id;
  const state = await api.waitForState(moduleId, ['WAITING', 'FINISHED'], 60000);
  console.log('MODULE STATE:', state);
  if (state === 'FINISHED') {
    const done = await api.getModuleInfo(moduleId);
    console.log('MODULE FINAL: FINISHED result:', done.result);
    return;
  }

  // The Digital Credentials API request and the submit URL: the
  // module's log carries both — the {digital: {requests: [...]}}
  // payload and the browser_api_submit URL the suite's own page POSTs
  // the response to.
  const log = (await api.getTestLog(moduleId)) as any[];
  let requestJwt = '';
  let requestData: any = null;
  let protocol = '';
  let submitUrl = '';
  for (const entry of log) {
    if (entry.request?.digital?.requests) {
      const req = entry.request.digital.requests[0];
      protocol = req.protocol;
      // The multisigned protocol carries the general JWS as a JSON
      // OBJECT; the others carry the compact JWS as text.
      requestJwt = typeof req.data.request === 'string'
        ? req.data.request
        : JSON.stringify(req.data.request);
      if (!requestJwt) requestData = req.data;
      console.log('REQUEST PROTOCOL:', protocol, '| request form:', requestJwt ? (requestJwt.trim().startsWith('{') ? 'general JWS' : 'compact') : 'plain data');
    }
    if (entry.browser_api_submit?.fullUrl) {
      submitUrl = entry.browser_api_submit.fullUrl;
    }
  }
  console.log('SUBMIT URL:', submitUrl);
  if ((!requestJwt && !requestData) || !submitUrl) {
    throw new Error('the module exposed no browser API request or submit URL');
  }

  // The mini-wallet page: the caller's origin beside the request —
  // the signed protocol's JWT by value (?request=), the unsigned
  // protocol's plain request object (?dcreq= base64url).
  const origin = 'https://localhost.emobix.co.uk:8443';
  const pageUrl = requestJwt
    ? `${MINI_WALLET_URL}?request=${encodeURIComponent(requestJwt)}&origin=${encodeURIComponent(origin)}`
    : `${MINI_WALLET_URL}?dcreq=${encodeURIComponent(
        Buffer.from(JSON.stringify(requestData)).toString('base64url')
      )}&origin=${encodeURIComponent(origin)}`;
  await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(10000);

  console.log('PAGE PARAMS SENT:', await page.evaluate(() => {
    const url = new URLSearchParams(window.location.search).get('request') || '';
    const parts = url.split('.').length;
    return JSON.stringify({ len: url.length, parts, hasScheme: url.includes('://') });
  }));
  console.log('FLOW STATE:', await page.getAttribute('body', 'data-flow-state'));
  const lastResult = await page.evaluate(() => (window as any).__last_result ?? null);
  console.log('LAST RESULT:', lastResult === null ? 'null' : JSON.stringify(lastResult).slice(0, 300));
  console.log('BOOT ERROR:', await page.evaluate(() => (window as any).__boot_error || null));
  const errorDetail = await page.evaluate(() => (window as any).__boot_error_detail || null);
  if (errorDetail) console.log('ERROR DETAIL:', JSON.stringify(errorDetail).slice(0, 400));
  console.log('LOGS:\n' + logs.join('\n'));

  // The response's data: the engine's wmp.flow.complete notification
  // carries the DigitalCredential's data (the page stores it through
  // the onNotification callback); hand it to the submit URL with the
  // requested protocol, as the suite's own page does.
  const flowResult = await page.evaluate(() => (window as any).__flow_result ?? null);
  console.log('FLOW RESULT:', flowResult === null ? 'null' : JSON.stringify(flowResult).slice(0, 200));
  const dcApiData = flowResult?.dc_api_response ?? lastResult?.result?.dc_api_response ?? lastResult?.dc_api_response;
  if (dcApiData) {
    const res = await page.request.fetch(submitUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      data: { protocol: protocol || 'openid4vp-v1-signed', data: dcApiData },
      failOnStatusCode: false,
      ignoreHTTPSErrors: true,
    });
    console.log('SUBMIT:', res.status());
  } else {
    console.log('NO DC API RESPONSE in the flow result');
    const fr = await page.evaluate(() => (window as any).__flow_result ?? null);
    console.log('FLOW RESULT FULL:', fr === null ? 'null' : JSON.stringify(fr).slice(0, 400));
  }

  // The negative tests: the browser API's promise rejects (the wallet
  // refused the request) — the module's page posts the rejection to
  // the submit URL — and then the tester's error-screen placeholder
  // (the log entry's `upload` member) finishes it.
  const flowState = await page.getAttribute('body', 'data-flow-state');
  if (flowState === 'error') {
    // The promise rejection, as the suite's own page posts it.
    if (submitUrl) {
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
      console.log('REJECTION SUBMIT:', res.status());
      await page.waitForTimeout(5000);
    }
    try {
      const logNow = (await api.getTestLog(moduleId)) as any[];
      const placeholder = logNow.find((e: any) => typeof e.upload === 'string')?.upload;
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
  const finalLog = (await api.getTestLog(moduleId).catch(() => [] as any[])) as any[];
  const failures = finalLog.filter((e: any) => String(e.result).toUpperCase().includes('FAIL'));
  console.log('FAIL COUNT:', failures.length);
  const seen = new Set<string>();
  for (const f of failures) {
    if (seen.has(f.msg)) continue;
    seen.add(f.msg);
    console.log('FAIL:', JSON.stringify(f).slice(0, 500));
  }
});
