/**
 * VC Services API Helper
 *
 * Service Ports (default):
 *   - 9000: vc-issuer (OpenID4VCI)
 *   - 9001: vc-verifier (OpenID4VP + OIDC)
 *   - 9002: vc-mockas (Mock Auth Server)
 *   - 9003: vc-apigw (API Gateway / OAuth AS)
 *   - 9004: vc-registry (Status Lists)
 */

import { request } from '@playwright/test';

// =============================================================================
// Environment Configuration
// =============================================================================

export const VC_ENV = {
  VC_ISSUER_URL: process.env.VC_ISSUER_URL || process.env.ISSUER_URL || 'http://localhost:9000',
  VC_VERIFIER_URL: process.env.VC_VERIFIER_URL || process.env.VERIFIER_URL || 'http://localhost:9001',
  VC_MOCKAS_URL: process.env.VC_MOCKAS_URL || 'http://localhost:9002',
  VC_APIGW_URL: process.env.VC_APIGW_URL || 'http://localhost:9003',
  VC_REGISTRY_URL: process.env.VC_REGISTRY_URL || 'http://localhost:9004',
};

// =============================================================================
// Credential Types
// =============================================================================

export const CREDENTIAL_TYPES = {
  PID_1_8: 'urn:eudi:pid:arf-1.8:1',
  PID_1_5: 'urn:eudi:pid:arf-1.5:1',
  EHIC: 'urn:eudi:ehic:1',
  DIPLOMA: 'urn:eudi:diploma:1',
  EDUID: 'urn:credential:eduid:1',
} as const;

export type CredentialType = typeof CREDENTIAL_TYPES[keyof typeof CREDENTIAL_TYPES];

// =============================================================================
// Service Health Checks
// =============================================================================

export async function checkVCServicesHealth(): Promise<{
  issuer: boolean;
  verifier: boolean;
  apigw: boolean;
  registry: boolean;
  mockas: boolean;
}> {
  const results = {
    issuer: false,
    verifier: false,
    apigw: false,
    registry: false,
    mockas: false,
  };

  const checks = [
    { name: 'issuer' as const, url: `${VC_ENV.VC_ISSUER_URL}/health` },
    { name: 'verifier' as const, url: `${VC_ENV.VC_VERIFIER_URL}/health` },
    { name: 'apigw' as const, url: `${VC_ENV.VC_APIGW_URL}/.well-known/oauth-authorization-server` },
    { name: 'registry' as const, url: `${VC_ENV.VC_REGISTRY_URL}/health` },
    { name: 'mockas' as const, url: `${VC_ENV.VC_MOCKAS_URL}/health` },
  ];

  const apiContext = await request.newContext();

  for (const check of checks) {
    try {
      const response = await apiContext.get(check.url, { timeout: 5000 });
      results[check.name] = response.ok();
    } catch {
      results[check.name] = false;
    }
  }

  await apiContext.dispose();
  return results;
}

// =============================================================================
// Credential Offer API
// =============================================================================

export interface CreatedOffer {
  credential_offer: any;
  credential_offer_uri: string;
  pre_authorized_code?: string;
  expires_in?: number;
  grants?: Record<string, any>;
}

function credentialTypeToScope(credentialType: CredentialType): string {
  switch (credentialType) {
    case CREDENTIAL_TYPES.PID_1_8: return 'pid_1_8';
    case CREDENTIAL_TYPES.PID_1_5: return 'pid_1_5';
    case CREDENTIAL_TYPES.EHIC: return 'ehic';
    case CREDENTIAL_TYPES.DIPLOMA: return 'diploma';
    case CREDENTIAL_TYPES.EDUID: return 'eduid';
    default:
      const parts = (credentialType as string).split(':');
      return parts[parts.length - 2] || credentialType;
  }
}

export async function createCredentialOffer(
  credentialType: CredentialType,
  _userIdentifier: string,
  options: { walletId?: string } = {}
): Promise<CreatedOffer> {
  const apiContext = await request.newContext();
  const scope = credentialTypeToScope(credentialType);
  const walletId = options.walletId || 'local';

  try {
    const response = await apiContext.get(
      `${VC_ENV.VC_APIGW_URL}/offers/${scope}/${walletId}`,
      { timeout: 10000 }
    );

    if (!response.ok()) {
      const error = await response.text();
      throw new Error(`Failed to create credential offer: ${response.status()} - ${error}`);
    }

    const result = await response.json();
    const offerUri = result.qr?.uri || '';

    let parsedOffer: any;
    try {
      const url = new URL(offerUri);
      const co = url.searchParams.get('credential_offer');
      if (co) parsedOffer = JSON.parse(decodeURIComponent(co));
    } catch { /* ignore */ }

    return {
      credential_offer_uri: offerUri,
      credential_offer: parsedOffer,
      pre_authorized_code: parsedOffer?.grants?.['urn:ietf:params:oauth:grant-type:pre-authorized_code']?.['pre-authorized_code'],
      grants: parsedOffer?.grants,
      expires_in: 300,
    };
  } finally {
    await apiContext.dispose();
  }
}

export function buildWalletOfferUrl(frontendUrl: string, offerUri: string): string {
  const params = offerUri.replace('openid-credential-offer://?', '');
  return `${frontendUrl}/cb?${params}`;
}
