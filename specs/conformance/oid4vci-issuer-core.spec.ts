/**
 * OpenID4VCI Issuer Conformance Tests — siros-issuer-core
 *
 * Runs the OpenID Foundation Conformance Suite OID4VCI issuer test plan
 * against siros-issuer-core (Rust), the same way oid4vci-issuer.spec.ts
 * runs it against the Go vc-issuer.
 *
 * The core is P2 scope (design §12.1): both grants are implemented —
 * pre-authorized and authorization_code (PAR + Mode A login handoff +
 * PKCE + DPoP sender-constraining).
 *
 * Prerequisites:
 *   - docker build --network=host -t siros-issuer-core:local ../siros-issuer-core
 *   - make up-issuer-core
 *   - /etc/hosts: 127.0.0.1 localhost.emobix.co.uk
 */

import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { ConformanceAPI, type LogEntry, type TestState } from '../../helpers/conformance-api';
import { SignJWT, importJWK } from 'jose';
import * as crypto from 'node:crypto';

const CONFORMANCE_URL = process.env.CONFORMANCE_URL || 'https://localhost.emobix.co.uk:8443/';

// The suite container resolves the compose-network name; Playwright (and
// its health check) runs on the host and uses the published port.
const ISSUER_CONFORMANCE_URL =
  process.env.ISSUER_CORE_CONFORMANCE_URL ||
  'https://issuer.conformance.example.com:9443';
// The suite resolves the issuer over the compose network; the runner
// (minting + health) uses the host-published ports.
const ISSUER_HOST_URL = process.env.ISSUER_CORE_HOST_URL || 'http://localhost:9016';
const ISSUER_PROXY_HOST_URL =
  process.env.ISSUER_CORE_PROXY_HOST_URL || 'https://localhost:9444';

// Variant fields per the suite's oid4vci-1_0-issuer-test-plan
// (probed from the deployed suite; see docs/issuer-core.md):
//   credential_format: sd_jwt_vc | mdoc
//   vci_grant_type: authorization_code | pre_authorization_code
//   vci_authorization_code_flow_variant: wallet_initiated | issuer_initiated
//   vci_credential_encryption: plain | encrypted
//   sender_constrain: mtls | dpop
//   authorization_request_type: simple | rar
//   openid: plain_oauth | openid_connect
//   client_auth_type: none | ... — NOTE: this plan build only selects
//   modules for private_key_jwt (probed; see docs/issuer-core.md)
//   grant_management: disabled | enabled
//   fapi_request_method: unsigned | signed_non_repudiation
//   fapi_profile: vci | vci_haip | ...
//   fapi_response_mode: plain_response | jarm
const VCI_ISSUER_VARIANTS = [
  {
    name: 'sd_jwt_vc / pre_authorization_code / issuer_initiated / dpop / plain',
    // What the suite requests: the configuration id (suite config
    // vci.credential_configuration_id) and the scope its wallet PARs
    // with (issuer [authorization.scopes] maps it back to the same
    // configuration — urn:eudi:pid:1 is the dc+sd-jwt PID,
    // eu.europa.ec.eudi.pid.1 the mso_mdoc PID).
    credential: { id: 'urn:eudi:pid:1', scope: 'pid' },
    variant: {
      credential_format: 'sd_jwt_vc',
      vci_grant_type: 'pre_authorization_code',
      vci_authorization_code_flow_variant: 'issuer_initiated',
      vci_credential_encryption: 'plain',
      sender_constrain: 'dpop',
      authorization_request_type: 'simple',
      openid: 'plain_oauth',
      client_auth_type: 'private_key_jwt',
      grant_management: 'disabled',
      fapi_request_method: 'unsigned',
      fapi_profile: 'vci',
      fapi_response_mode: 'plain_response',
    },
  },
  {
    name: 'sd_jwt_vc / authorization_code / wallet_initiated / dpop / plain',
    credential: { id: 'urn:eudi:pid:1', scope: 'pid' },
    variant: {
      credential_format: 'sd_jwt_vc',
      vci_grant_type: 'authorization_code',
      vci_authorization_code_flow_variant: 'wallet_initiated',
      vci_credential_encryption: 'plain',
      sender_constrain: 'dpop',
      authorization_request_type: 'simple',
      openid: 'plain_oauth',
      client_auth_type: 'private_key_jwt',
      grant_management: 'disabled',
      fapi_request_method: 'unsigned',
      fapi_profile: 'vci',
      fapi_response_mode: 'plain_response',
    },
  },
  {
    name: 'mdoc / pre_authorization_code / issuer_initiated / dpop / plain',
    // mdoc subject data nests under the doctype namespace (mso_mdoc
    // catalog paths are [namespace, element]).
    credential: { id: 'eu.europa.ec.eudi.pid.1', scope: 'pid_mdoc' },
    variant: {
      credential_format: 'mdoc',
      vci_grant_type: 'pre_authorization_code',
      vci_authorization_code_flow_variant: 'issuer_initiated',
      vci_credential_encryption: 'plain',
      sender_constrain: 'dpop',
      authorization_request_type: 'simple',
      openid: 'plain_oauth',
      client_auth_type: 'private_key_jwt',
      grant_management: 'disabled',
      fapi_request_method: 'unsigned',
      fapi_profile: 'vci',
      fapi_response_mode: 'plain_response',
    },
  },
  {
    name: 'mdoc / authorization_code / wallet_initiated / dpop / plain',
    credential: { id: 'eu.europa.ec.eudi.pid.1', scope: 'pid_mdoc' },
    variant: {
      credential_format: 'mdoc',
      vci_grant_type: 'authorization_code',
      vci_authorization_code_flow_variant: 'wallet_initiated',
      vci_credential_encryption: 'plain',
      sender_constrain: 'dpop',
      authorization_request_type: 'simple',
      openid: 'plain_oauth',
      client_auth_type: 'private_key_jwt',
      grant_management: 'disabled',
      fapi_request_method: 'unsigned',
      fapi_profile: 'vci',
      fapi_response_mode: 'plain_response',
    },
  },
];

const VCI_ISSUER_PLAN_NAME = 'oid4vci-1_0-issuer-test-plan';

const VCI_ISSUER_CONFIG_PATH = path.resolve(
  __dirname,
  '../../configs/conformance/vci-issuer-core-config.json'
);

const RESULTS_DIR =
  process.env.CONFORMANCE_RESULTS_DIR || path.resolve(__dirname, '../../conformance-results');

// =============================================================================
// Helpers
// =============================================================================

// The key-attestation issuer fixture: the suite's wallet signs its
// key-attestation proofs with this key (header x5c from the JWK's x5c —
// AbstractSignJWT requires it). Our issuer verifies the attestation's
// self-consistency against that leaf.
const KEY_ATTESTATION_JWK_PATH = path.resolve(
  __dirname,
  '../../fixtures/siros-issuer-core/attestation-issuer.jwk'
);

function loadIssuerConfig(variantConfig: {
  credential: { id: string; scope: string };
}): string {
  let config = fs.readFileSync(VCI_ISSUER_CONFIG_PATH, 'utf-8');
  // vci.credential_issuer_url is the *identifier* (base), not the
  // discovery path — §12.2.3 requires byte-identical equality with the
  // metadata's credential_issuer.
  config = config.replace(/\$\{ISSUER_DISCOVERY_URL\}/g, ISSUER_CONFORMANCE_URL);
  config = config.replace(/\$\{ISSUER_RESOURCE_URL\}/g, ISSUER_CONFORMANCE_URL);
  // Variant-aware: the credential the suite requests (and the scope its
  // wallet PARs with) follow the variant's credential_format.
  config = config.replace(
    /\$\{CREDENTIAL_CONFIGURATION_ID\}/g,
    variantConfig.credential.id
  );
  config = config.replace(/\$\{CLIENT_SCOPE\}/g, variantConfig.credential.scope);
  // The key-attestation JWKS (object, not string) — spliced in as JSON.
  const keyAttestationJwks = JSON.parse(
    fs.readFileSync(KEY_ATTESTATION_JWK_PATH, 'utf-8')
  );
  config = config.replace(
    /\$\{KEY_ATTESTATION_JWKS\}/g,
    JSON.stringify({ keys: [keyAttestationJwks] })
  );
  return config;
}

// The issuer's backend session API auth: a Bearer client-assertion JWT
// signed with the dev portal's integrator key (the fixtures' JWK). The
// runner mints pre-authorized offers as the "integrating application"
// (design §6): the suite consumes them at its exposed endpoint.
const INTEGRATOR_JWK_PATH = path.resolve(
  __dirname,
  '../../fixtures/siros-issuer-core/integrator.jwk'
);

async function integratorAssertion(): Promise<string> {
  const jwk = JSON.parse(fs.readFileSync(INTEGRATOR_JWK_PATH, 'utf-8'));
  const key = await importJWK(jwk, jwk.alg || 'ES256');
  const { d: _d, ...publicJwk } = jwk;
  return new SignJWT({})
    .setProtectedHeader({ alg: jwk.alg || 'ES256', kid: jwk.kid, jwk: publicJwk })
    .setIssuer(jwk.kid)
    .setSubject(jwk.kid)
    .setAudience(ISSUER_CONFORMANCE_URL)
    .setIssuedAt()
    .setExpirationTime('5m')
    .setJti(crypto.randomUUID())
    .sign(key);
}

async function mintPreAuthorizedOffer(credentialId: string): Promise<
  { offerUri: string } | null
> {
  try {
    const response = await fetch(`${ISSUER_HOST_URL}/api/v1/issuance/sessions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${await integratorAssertion()}`,
      },
      body: JSON.stringify({
        credential: credentialId,
        // mdoc subjects nest under the doctype namespace ([namespace,
        // element] paths); sd_jwt_vc subjects are flat.
        subject: credentialId.startsWith('urn:')
          ? {
              given_name: 'Conformance',
              family_name: 'Tester',
              birth_date: '1982-07-12',
            }
          : {
              [credentialId]: {
                given_name: 'Conformance',
                family_name: 'Tester',
                birth_date: '1982-07-12',
                place_of_birth: { country: 'SE', locality: 'Stockholm' },
                nationality: ['SE'],
                issuing_authority: 'Skatteverket',
                issuing_country: 'SE',
              },
            },
      }),
    });
    if (!response.ok) {
      console.log(`offer minting failed: ${response.status} ${await response.text()}`);
      return null;
    }
    const reply = await response.json();
    return { offerUri: reply.offer_uri };
  } catch (error) {
    console.log('offer minting error:', (error as Error).message);
    return null;
  }
}

async function checkCoreIssuerHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${ISSUER_HOST_URL}/healthz`);
    if (!response.ok) return false;
    const health = await response.json();
    return health.status === 'ok';
  } catch {
    return false;
  }
}

// =============================================================================
// Tests
// =============================================================================

/**
 * Wait for a pre-authorized module to be ready for its NEXT offer
 * delivery: either the module FINISHED (return 'finished' — the caller
 * must not deliver again), or the module logged a fresh
 * "Waiting for call to credential offer endpoint" marker past the number
 * of offers already accepted (return 'next-client').
 *
 * Keying on the MARKER COUNT rather than the sampled state is the point:
 * the module logs one marker per client, and the marker only appears once
 * the previous client's flow fully completed. The module's state stays
 * WAITING THROUGH each client's processing — sampling the state after a
 * delivery answers WAITING while the flow is still mid-run, and a fast
 * module (CI timing) then accepts the next delivery before its current
 * one completes, or after it FINISHED — the illegal FINISHED -> RUNNING
 * state change flips the verdict (observed live: the suite log shows the
 * third offer arriving at "Test has run to completion" + 1).
 */
async function waitForOfferSlot(
  api: ConformanceAPI,
  moduleId: string,
  acceptedOffers: number,
  timeoutMs: number
): Promise<'finished' | 'next-client' | 'timeout'> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const info = await api.getModuleInfo(moduleId);
      if (info.status === 'FINISHED') return 'finished';
      if (info.status === 'INTERRUPTED') return 'finished';
    } catch {
      /* transient suite error during a state change — retry */
    }
    try {
      const log = await api.getTestLog(moduleId);
      const markers = log.filter((l: LogEntry) =>
        (l.msg || '').includes('Waiting for call to credential offer endpoint')
      ).length;
      if (markers > acceptedOffers) return 'next-client';
    } catch {
      /* transient — retry */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return 'timeout';
}

test.describe('OID4VCI Issuer Conformance Suite (siros-issuer-core)', () => {
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
    issuerReady = await checkCoreIssuerHealth();
    if (!issuerReady) {
      console.log('siros-issuer-core not available at', ISSUER_CONFORMANCE_URL);
    }
  });

  test.beforeEach(async () => {
    if (!conformanceReady) {
      test.skip(true, 'Conformance suite not available');
      return;
    }
    if (!issuerReady) {
      test.skip(true, 'siros-issuer-core not available');
    }
  });

  for (const variantConfig of VCI_ISSUER_VARIANTS) {
    test.describe(`Variant: ${variantConfig.name}`, () => {
      let planId: string;
      let planModules: string[];

      test.beforeAll(async () => {
        if (!conformanceReady || !issuerReady) return;

        const configJson = loadIssuerConfig(variantConfig);
        console.log(
          `Creating issuer test plan with config targeting: ${ISSUER_CONFORMANCE_URL}`
        );

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
            const message = (error as Error).message;
            const interrupted = message.includes('interrupted');
            console.log(
              `Module ${moduleName} ${interrupted ? 'was interrupted' : 'timed out'}: ${message}`
            );
            results.push({
              module: moduleName,
              status: 'ERROR',
              result: interrupted ? 'INTERRUPTED' : 'TIMEOUT',
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

          // WAITING: drive the module by grant type. Pre-authorized
          // (issuer-initiated) modules expose their credential_offer
          // endpoint and expect minted offers — possibly more than once
          // (the multiple-clients test consumes one offer per client).
          // Wallet-initiated (authorization_code) modules PAR themselves
          // and need the browser to walk our Mode A login handoff: the
          // suite page redirects to our /authorize, we 302 to the dev
          // portal, the form completes the authorization server-to-server,
          // and the browser lands back on the suite callback. Metadata
          // tests never wait — they finish on their own and must not be
          // touched (a stray offer delivery to a FINISHED module is an
          // illegal state change on the suite).
          const isPreAuth =
            variantConfig.variant.vci_grant_type === 'pre_authorization_code';

          if (state === 'WAITING') {
            if (isPreAuth) {
              // Only deliver to modules actually waiting for a credential
              // offer (the metadata tests WAIT for the operator but serve
              // no credential_offer path — a stray delivery is an illegal
              // suite state change).
              const preRunLog = await api.getTestLog(moduleId);
              const waitingForOffer = preRunLog.some(
                (l: any) => (l.msg || '').includes('Waiting for call to credential offer endpoint')
              );
              if (!waitingForOffer) {
                console.log(
                  `Module ${moduleName}: WAITING but not for a credential offer — leaving it alone`
                );
              } else
              for (let offerNo = 0; offerNo < 4; offerNo++) {
                const offer = await mintPreAuthorizedOffer(variantConfig.credential.id);
                if (!offer) {
                  console.log(`Module ${moduleName}: could not mint an offer`);
                  break;
                }
                const delivery = new URL(
                  `${CONFORMANCE_URL.replace(/\/$/, '')}/test/${moduleId}/credential_offer`
                );
                delivery.searchParams.set('credential_offer_uri', offer.offerUri);
                const delivered = await fetch(delivery, { method: 'POST' });
                console.log(
                  `Module ${moduleName}: offer #${offerNo + 1} delivery -> ${delivered.status}`
                );
                // A refused delivery (the module has no client left to
                // feed) is not an error — its verdict stands.
                if (delivered.status >= 400) break;
                // Wait for the module to be ready for the NEXT offer:
                // either it FINISHED (the verdict stands — never deliver
                // again), or it logged a fresh wait-for-offer marker.
                // The modules log ONE marker per client, and the marker
                // only appears after the previous client's flow fully
                // completed — a bare state sample is a race (WAITING
                // holds THROUGH each client's processing, so a fast
                // module invites over-delivery: proven live on CI, a
                // third offer landed on a FINISHED module and the
                // illegal state change flipped the verdict).
                const slot = await waitForOfferSlot(api, moduleId, offerNo + 1, 90000);
                if (slot !== 'next-client') {
                  console.log(
                    `Module ${moduleName}: no further offer slot (${slot})`
                  );
                  break;
                }
              }
            } else {
              // Wallet-initiated: the module PARs and exposes
              // `redirect_to_authorization_endpoint` in its log — the
              // browser follows it to OUR /authorize (Mode A handoff →
              // portal → back to the suite callback). Drive once per
              // client the module waits for (multiple-clients waits
              // twice: one authorize per client).
              for (let drive = 0; drive < 4; drive++) {
                const moduleLog = await api.getTestLog(moduleId);
                // One redirect_to_authorization_endpoint per client;
                // drive N takes the Nth entry (find() would replay
                // client 1's authorize for every drive).
                const redirects = moduleLog.filter(
                  (l: any) => l.redirect_to_authorization_endpoint
                );
                const browserUrl = redirects[drive]?.redirect_to_authorization_endpoint as
                  | string
                  | undefined;
                if (!browserUrl) {
                  console.log(
                    `Module ${moduleName}: no redirect_to_authorization_endpoint exposed`
                  );
                  break;
                }
                console.log(
                  `Module ${moduleName}: browser interaction #${drive + 1} at ${browserUrl.slice(0, 100)}`
                );
                await page.goto(browserUrl, { waitUntil: 'load', timeout: 60000 });
                await page.waitForTimeout(3000);

                // Our authorize hands off to the dev portal's login form;
                // it completes the authorization server-to-server and
                // redirects back to the suite callback.
                const loginInput = page
                  .locator('input[name="username"], input[type="text"]')
                  .first();
                if (await loginInput.isVisible({ timeout: 5000 }).catch(() => false)) {
                  console.log(`Module ${moduleName}: filling dev portal login form`);
                  await loginInput.fill('test-user-001');
                  const submitBtn = page
                    .locator('button[type="submit"], input[type="submit"]')
                    .first();
                  if (await submitBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
                    await submitBtn.click();
                    await page.waitForTimeout(5000);
                  }
                }
                const nextState = await api.waitForState(
                  moduleId,
                  ['WAITING', 'FINISHED'],
                  60000
                );
                if (nextState !== 'WAITING') break;
              }
            }
          }

          try {
            await api.waitForState(moduleId, ['FINISHED'], 90000);
          } catch (error) {
            const message = (error as Error).message;
            if (message.includes('interrupted')) {
              console.log(`Module ${moduleName} was interrupted after interaction`);
            } else {
              console.log(`Module ${moduleName} did not finish in time after interaction`);
            }
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
            } catch {
              /* best-effort */
            }
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

        // SKIPPED is neither pass nor failure: the suite skips modules
        // legitimately out of scope for the profile (e.g. unsigned
        // metadata in the -signed test). Failures are FAILED/TIMEOUT/
        // INTERRUPTED/ERROR only.
        const passed = results.filter((r) => r.passed);
        const skipped = results.filter((r) => r.result === 'SKIPPED');
        const failed = results.filter(
          (r) => !r.passed && r.result !== 'SKIPPED'
        );

        const summary = {
          profile: 'issuer-core',
          plan: VCI_ISSUER_PLAN_NAME,
          planId,
          variant: variantConfig.name,
          timestamp: new Date().toISOString(),
          planDetailUrl: api.getPlanDetailUrl(planId),
          total: results.length,
          passed: passed.length,
          skipped: skipped.length,
          failed: failed.length,
          modules: results,
        };
        const summaryPath = path.resolve(
          RESULTS_DIR,
          `issuer-core-summary-${variantConfig.name.replace(/[^\w.-]+/g, '-')}.json`
        );
        fs.mkdirSync(path.dirname(summaryPath), { recursive: true });
        fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
        console.log(
          `\n${variantConfig.name}: ${passed.length}/${results.length} modules passed, ${skipped.length} skipped, ${failed.length} failed`
        );
        expect(summary.failed).toBe(0);
      });
    });
  }
});