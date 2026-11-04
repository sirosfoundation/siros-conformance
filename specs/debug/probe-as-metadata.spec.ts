import { test } from '@playwright/test';
import * as fs from 'fs';
import { ConformanceAPI } from '../../helpers/conformance-api';

test('probe the suite AS metadata', async () => {
  const api = new ConformanceAPI('https://localhost.emobix.co.uk:8443/');
  await api.waitForServerReady(30000);
  const config = JSON.parse(fs.readFileSync('configs/conformance/vci-wallet-config.json', 'utf-8'));
  const plan = await api.createTestPlan('oid4vci-1_0-wallet-test-plan', JSON.stringify(config), {
    credential_format: 'sd_jwt_vc', vci_grant_type: 'pre_authorization_code',
    vci_credential_issuance_mode: 'immediate', vci_credential_offer_variant: 'by_value',
    sender_constrain: 'dpop', vci_credential_encryption: 'plain', fapi_profile: 'vci',
    fapi_request_method: 'unsigned', client_auth_type: 'private_key_jwt',
    authorization_request_type: 'simple', vci_authorization_code_flow_variant: 'issuer_initiated',
  });
  const mod = await api.createTestFromPlan(plan.id, 'oid4vci-1_0-wallet-test-credential-issuance');
  await api.waitForState(mod.id, ['WAITING'], 60000);
  // keep the module waiting while we curl the metadata
  const https = await import('https');
  const get = (url: string) => new Promise((resolve, reject) => {
    https.get(url, { rejectUnauthorized: false }, (res: any) => {
      let d = '';
      res.on('data', (c: any) => d += c);
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    }).on('error', reject);
  });
  const as = await get('https://localhost.emobix.co.uk:8443/.well-known/oauth-authorization-server/test/a/siros-wallet-vci-test/');
  console.log('AS STATUS', (as as any).status);
  const body = JSON.parse((as as any).body);
  console.log('auth methods:', JSON.stringify(body.token_endpoint_auth_methods_supported));
  console.log('token_endpoint:', body.token_endpoint);
  console.log('issuer:', body.issuer);
});
