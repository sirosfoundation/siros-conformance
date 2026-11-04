import { test } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { ConformanceAPI } from '../../helpers/conformance-api';

const CONFORMANCE_URL = 'https://localhost.emobix.co.uk:8443/';
const MINI_WALLET_URL = 'http://localhost:3010/';
const VCI_PLAN_NAME = 'oid4vci-1_0-wallet-test-plan';
const VCI_CONFIG_PATH = path.resolve(
  __dirname,
  '../../configs/conformance/vci-wallet-config.json'
);

test('drive one real suite module through the mini-wallet page', async ({ page }) => {
  const logs: string[] = [];
  page.on('console', (msg) => logs.push(`${msg.type()}: ${msg.text().slice(0, 300)}`));
  page.on('pageerror', (err) => logs.push(`PAGEERROR: ${err.message.slice(0, 300)}`));
  page.on('requestfailed', (req) =>
    logs.push(`REQFAIL: ${req.url().slice(0, 200)} ${req.failure()?.errorText}`)
  );
  page.on('response', (resp) => {
    if (resp.status() >= 400) {
      logs.push(
        `HTTP ${resp.status()} ${resp.url().slice(0, 200)}`
      );
    }
  });

  // every request to the suite host: does it carry a DPoP proof?
  page.on('request', (req) => {
    if (req.url().includes('emobix') && req.method() === 'POST') {
      console.log('SUITE REQ:', req.method(), req.url().replace('https://localhost.emobix.co.uk:8443', ''), 'dpop:', req.headers()['dpop'] ? 'yes' : 'NO');
    }
  });

  let tokenBody = '';
  const tokenCapture: any[] = [];
  await page.route('**/token', async (route) => {
    if (route.request().method() === 'POST') {
      tokenBody = route.request().postData() || '';
      tokenCapture.push({ headers: route.request().headers(), body: tokenBody });
    }
    await route.continue();
  });
  page.on('response', async (resp) => {
    if (resp.url().includes('/token') && resp.status() >= 400) {
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(resp.headers())) headers[k] = v;
      console.log('TOKEN RESPONSE', resp.status(), JSON.stringify(headers), JSON.stringify(await resp.text().catch(() => '')).slice(0, 200));
    }
  });

  let credInfo = '';
  await page.route('**/credential**', async (route) => {
    const req = route.request();
    credInfo = JSON.stringify({
      method: req.method(),
      url: req.url(),
      headers: req.headers(),
      body: req.postData() || '',
    });
    await route.continue();
  });
  page.on('response', async (resp) => {
    if (resp.url().includes('/credential') && resp.status() >= 400) {
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(resp.headers())) headers[k] = v;
      console.log('CRED RESPONSE', resp.status(), JSON.stringify(headers).slice(0, 400), JSON.stringify(await resp.text().catch(() => '')).slice(0, 300));
    }
  });

  const api = new ConformanceAPI(CONFORMANCE_URL);
  await api.waitForServerReady(30000);

  const config = JSON.parse(fs.readFileSync(VCI_CONFIG_PATH, 'utf-8'));
  const plan = await api.createTestPlan(VCI_PLAN_NAME, JSON.stringify(config), {
    credential_format: 'sd_jwt_vc',
    vci_grant_type: 'pre_authorization_code',
    vci_credential_issuance_mode: process.env.VCI_MODE || 'immediate',
    vci_credential_offer_variant: 'by_value',
    sender_constrain: 'dpop',
    vci_credential_encryption: 'plain',
    fapi_profile: 'vci',
    fapi_request_method: 'unsigned',
    client_auth_type: 'private_key_jwt',
    authorization_request_type: 'simple',
    vci_authorization_code_flow_variant: 'issuer_initiated',
  });
  const planId = plan.id;
  const planModules = plan.modules.map((m) => m.testModule);
  console.log('PLAN', planId, 'MODULES:', planModules);

  // The credential-issuance module is the one that publishes the offer.
  const moduleName = planModules.find((m) => m.includes('credential-issuance')) || planModules[0];
  const moduleInfo = await api.createTestFromPlan(planId, moduleName);
  const moduleId = moduleInfo.id;
  const state = await api.waitForState(moduleId, ['WAITING', 'FINISHED'], 60000);
  console.log('MODULE', moduleName, 'STATE:', state);

  if (state === 'FINISHED') {
    console.log('Finished without wallet:', (await api.getModuleInfo(moduleId)).result);
    return;
  }

  const interactionUrl = await api.getWalletInteractionUrl(moduleId);
  console.log('INTERACTION URL:', interactionUrl);

  await page.goto(`${MINI_WALLET_URL}?offer=${encodeURIComponent(interactionUrl || '')}`, {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });
  await page.waitForTimeout(15000);

  console.log('FLOW STATE:', await page.getAttribute('body', 'data-flow-state'));
  console.log('MINI DEBUG:', JSON.stringify(await page.evaluate(() => (window as any).__mini_debug || null)));
  console.log('TOKEN BODY:', tokenBody.slice(0, 600));
  for (const cap of tokenCapture) {
    fs.writeFileSync('/tmp/opencode/token-cap.json', JSON.stringify(cap));
    console.log('TOKEN CAP SAVED; dpop len:', (cap.headers['dpop'] || '').length);
  }
  // decode the DPoP proof on the credential request
  const credHeaders = credInfo ? JSON.parse(credInfo).headers : {};
  const dpopHeader = credHeaders['dpop'] || '';
  if (dpopHeader) {
    const parts = dpopHeader.split('.');
    const dec = (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    console.log('CRED DPOP HEADER CLAIMS:', dec(parts[1] || ''));
    console.log('CRED DPOP JOSE HEADER:', dec(parts[0] || ''));
    console.log('CRED REQ AUTH:', credHeaders['authorization'] || '');
  } else {
    console.log('CRED DPOP: absent');
  }
  console.log('CRED REQ:', credInfo.slice(0, 120));
  // decode the OID4VCI proof JWT inside the credential request body
  if (credInfo) {
    const info = JSON.parse(credInfo);
    try {
      const body = JSON.parse((info as any).body || '{}');
      console.log('CRED BODY KEYS:', Object.keys(body).join(','));
      const jwt = body.proof?.jwt || body.proofs?.jwt?.[0] || '';
      if (jwt) {
        const parts = jwt.split('.');
        const dec = (t: string) => Buffer.from(t.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
        console.log('CRED PROOF JOSE:', dec(parts[0] || ''));
        console.log('CRED PROOF CLAIMS:', dec(parts[1] || ''));
      } else {
        console.log('CRED PROOF: absent');
      }
    } catch (e) {
      console.log('CRED BODY PARSE FAIL:', String(e));
    }
  }
  console.log('HAS ASSERTION:', tokenBody.includes('client_assertion='));
  console.log('LAST ERROR:', JSON.stringify(await page.evaluate(() => (window as any).__last_error)));
  console.log('BOOT ERROR:', await page.evaluate(() => (window as any).__boot_error || null));
  console.log('HAS ENGINE:', await page.evaluate(() => !!(window as any).__engine));
  console.log('LOGS:\n' + logs.join('\n'));

  const finalState = await api.waitForState(moduleId, ['FINISHED'], 60000).catch(() => 'TIMEOUT');
  const finalInfo = await api.getModuleInfo(moduleId).catch(() => null);
  console.log('MODULE FINAL:', finalState, 'result:', finalInfo && (finalInfo as any).result, 'status:', finalInfo && (finalInfo as any).status);
  // Which sub-tests failed, and why.
  const log = await api.getTestLog(moduleId).catch(() => [] as any[]);
  const failures = (log as any[]).filter((e: any) => String(e.result).toUpperCase().includes('FAIL'));
  console.log('FAIL COUNT:', failures.length);
  const seen = new Set<string>();
  for (const f of failures) {
    const key = f.msg || '';
    if (seen.has(key)) continue;
    seen.add(key);
    console.log('FAIL:', JSON.stringify(f).slice(0, 700));
  }
  if (failures.length === 0) {
    // dump the log tail for inspection
    for (const e of (log as any[]).slice(-8)) {
      console.log('LOG:', JSON.stringify(e).slice(0, 300));
    }
  }
});
