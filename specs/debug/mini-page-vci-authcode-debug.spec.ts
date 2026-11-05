/**
 * The one-module OID4VCI authorization-code debug driver: the mini-wallet
 * page against the suite's first issuance module, with full capture —
 * the offer, the PAR, the AS authorization page (the login/consent form
 * the tester answers), the redirect back, the resume, and the module's
 * condition failures. VCI_MODULE picks the module.
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
const VCI_PLAN_NAME = process.env.VCI_PLAN_NAME || 'oid4vci-1_0-wallet-test-plan';
const VCI_CONFIG_PATH = path.resolve(
  __dirname,
  '../../configs/conformance/vci-wallet-config.json'
);
const VCI_MODULE = process.env.VCI_MODULE || 'oid4vci-1_0-wallet-test-credential-issuance';

test('drive one OID4VCI authorization-code module through the mini-wallet page', async ({ page }) => {
  const logs: string[] = [];
  page.on('console', (msg) => logs.push(`${msg.type()}: ${msg.text().slice(0, 400)}`));
  page.on('pageerror', (err) => logs.push(`PAGEERROR: ${err.message.slice(0, 400)}`));
  page.on('requestfailed', (req) =>
    logs.push(`REQFAIL: ${req.url().slice(0, 200)} ${req.failure()?.errorText}`)
  );
  page.on('response', async (resp) => {
    if (resp.url().includes('emobix') && resp.status() >= 400) {
      console.log('SUITE RESP:', resp.status(), resp.url().slice(0, 160));
      if (resp.url().includes('/par')) {
        const body = await resp.text().catch(() => '<no body>');
        console.log('PAR 401 BODY:', body.slice(0, 500));
      }
    }
  });

  const api = new ConformanceAPI(CONFORMANCE_URL);
  await api.waitForServerReady(30000);

  const config = JSON.parse(fs.readFileSync(VCI_CONFIG_PATH, 'utf8'));
  // The mini-wallet's redirect_uri: the page itself — the AS sends the
  // code back here and the load handler resumes the flow. The config
  // file carries wallet-frontend's /cb.
  config.client = config.client || {};
  config.client.redirect_uri = `${MINI_WALLET_URL}`;
  console.log('CONFIG redirect_uri:', config.client.redirect_uri);

  const plan = await api.createTestPlan(VCI_PLAN_NAME, JSON.stringify(config), {
    credential_format: process.env.VCI_FORMAT || 'sd_jwt_vc',
    vci_grant_type: 'authorization_code',
    vci_credential_offer_variant: process.env.VCI_OFFER || 'by_value',
    vci_authorization_code_flow_variant: process.env.VCI_FLOW || 'issuer_initiated',
    sender_constrain: process.env.VCI_CONSTRAIN || 'dpop',
    vci_credential_encryption: 'plain',
    fapi_profile: 'vci',
    fapi_request_method: 'unsigned',
    client_auth_type: 'private_key_jwt',
    authorization_request_type: 'simple',
  });
  console.log('PLAN', plan.id);
  console.log('PLAN MODULES:', plan.modules.map((m) => m.testModule).join(', '));

  const moduleInfo = await api.createTestFromPlan(plan.id, VCI_MODULE);
  const moduleId = moduleInfo.id;
  const state = await api.waitForState(moduleId, ['WAITING', 'FINISHED'], 60000);
  console.log('MODULE STATE:', state);
  if (state === 'FINISHED') {
    const done = await api.getModuleInfo(moduleId);
    console.log('MODULE FINAL: FINISHED result:', done.result);
    return;
  }

  const interactionUrl = await api.getWalletInteractionUrl(moduleId);
  if (!interactionUrl) {
    console.log('NO INTERACTION URL — browser URL:', await api.getBrowserInteractionUrl(moduleId));
    return;
  }
  console.log('OFFER:', interactionUrl.slice(0, 200));

  // The suite attributes every request to the running test: no manual
  // metadata fetch here (a wrong-path one pollutes the module's
  // conditions — VCICheckOAuthAuthorizationServerMetadataRequestUrl).
  // The engine's own discovery is proven by the Phase 1 runs.
  const offerParams = JSON.parse(
    decodeURIComponent(interactionUrl.replace('openid-credential-offer://?credential_offer=', ''))
  );
  console.log('ISSUER:', offerParams.credential_issuer);

  const walletUrl = `${MINI_WALLET_URL}?offer=${encodeURIComponent(interactionUrl)}`;
  await page.goto(walletUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  console.log('NAVIGATED to the offer; page URL:', page.url());

  // The engine starts the flow: PAR, then open_authorization navigates
  // this tab to the AS. Watch for the navigation and capture whatever
  // the AS shows.
  let suiteAuthorizeUrl = '';
  for (let i = 0; i < 120; i++) {
    await page.waitForTimeout(1000);
    const url = page.url();
    const flowState = await page
      .getAttribute('body', 'data-flow-state')
      .catch(() => null);
    if (url !== walletUrl && url.includes('emobix') && !suiteAuthorizeUrl) {
      suiteAuthorizeUrl = url;
      console.log(`\n=== AS NAVIGATION (t+${i}s): ${url.slice(0, 200)}`);
      const html = await page.content().catch(() => '<no content>');
      console.log('AS HTML (first 3000):\n', html.slice(0, 3000));
      await page.screenshot({ path: '/tmp/opencode/vci-authcode-as.png' }).catch(() => {});
    }
    if (flowState === 'completed' || flowState === 'error') {
      console.log(`FLOW ${flowState} at t+${i}s; page URL: ${url.slice(0, 200)}`);
      break;
    }
    if (i % 15 === 0) {
      console.log(`t+${i}s state=${flowState} url=${url.slice(0, 120)}`);
    }
  }

  const finalState = await page.getAttribute('body', 'data-flow-state').catch(() => null);
  console.log('\nFINAL FLOW STATE:', finalState);
  console.log('PAGE URL:', page.url().slice(0, 200));
  const lastResult = await page.evaluate(() => (window as any).__last_result).catch(() => null);
  console.log('LAST RESULT:', JSON.stringify(lastResult)?.slice(0, 800));
  const lastError = await page.evaluate(() => (window as any).__last_error).catch(() => null);
  console.log('LAST ERROR:', JSON.stringify(lastError)?.slice(0, 800));
  const bootError = await page.evaluate(() => (window as any).__boot_error).catch(() => null);
  console.log('BOOT ERROR:', JSON.stringify(bootError)?.slice(0, 400));
  const kvKeys = await page.evaluate(() =>
    Object.keys(localStorage).filter((k) => k.includes('mini-wallet-kv')).map((k) => {
      const v = localStorage.getItem(k) || '';
      return `${k} = ${v.slice(0, 220)}`;
    })
  ).catch(() => [] as string[]);
  console.log('KV STORE:');
  for (const line of kvKeys) console.log('  ', line.slice(0, 240));

  const finishState = await api
    .waitForState(moduleId, ['FINISHED'], 120000)
    .catch(() => 'TIMEOUT');
  console.log('MODULE FINISH STATE:', finishState);
  const info = await api.getModuleInfo(moduleId);
  console.log('MODULE RESULT:', info.result);
  const { counts, failures } = await api.getModuleConditions(moduleId);
  console.log('CONDITIONS:', JSON.stringify(counts));
  for (const failure of failures.slice(0, 10)) {
    console.log('FAILURE:', JSON.stringify(failure).slice(0, 500));
  }

  console.log('\n=== PAGE CONSOLE LOGS ===');
  for (const line of logs.slice(-40)) console.log(line.slice(0, 400));
});