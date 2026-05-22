/**
 * Wallet automation helpers for conformance suite tests.
 *
 * Drives the wallet UI through credential offer acceptance
 * and credential presentation flows.
 */

import { Page, expect } from '@playwright/test';
import {
  CREDENTIAL_TYPES,
  type CredentialType,
  createCredentialOffer,
  buildWalletOfferUrl,
  checkVCServicesHealth,
} from './vc-services';
import { ENV } from './shared-helpers';

const FRONTEND_URL = process.env.WALLET_FRONTEND_URL || ENV.FRONTEND_URL;

// =============================================================================
// Health check
// =============================================================================

export async function isVCServicesAvailable(): Promise<boolean> {
  const health = await checkVCServicesHealth();
  return health.issuer && health.apigw;
}

// =============================================================================
// Credential Pre-loading (setup for VP tests)
// =============================================================================

export async function issueCredentialToWallet(
  page: Page,
  credentialType: CredentialType = CREDENTIAL_TYPES.PID_1_8,
  options: { walletId?: string; timeoutMs?: number } = {}
): Promise<{ success: boolean; error?: string }> {
  const { walletId = 'local', timeoutMs = 30000 } = options;

  try {
    const userId = `conf-setup-${Date.now()}`;
    console.log(`[WalletAutomation] Creating ${credentialType} offer for wallet setup...`);

    const offer = await createCredentialOffer(credentialType, userId, { walletId });
    if (!offer.credential_offer_uri) {
      return { success: false, error: 'No credential_offer_uri in response' };
    }

    console.log(`[WalletAutomation] Offer created: ${offer.credential_offer_uri.slice(0, 80)}...`);

    const walletUrl = buildWalletOfferUrl(FRONTEND_URL, offer.credential_offer_uri);
    console.log(`[WalletAutomation] Navigating wallet to accept offer...`);

    await page.goto(walletUrl, { waitUntil: 'networkidle', timeout: timeoutMs });
    await page.waitForTimeout(3000);

    const txCodeInput = page.locator('input[type="text"], input[type="number"]');
    if (await txCodeInput.isVisible({ timeout: 2000 }).catch(() => false)) {
      return { success: false, error: 'Unexpected transaction code popup from mock issuer' };
    }

    await page.waitForTimeout(5000);

    const errorElement = page.locator('[class*="error" i], [role="alert"]').first();
    const errorText = await errorElement.textContent({ timeout: 2000 }).catch(() => null);
    if (errorText && errorText.toLowerCase().includes('error')) {
      return { success: false, error: `Wallet error during issuance: ${errorText}` };
    }

    await page.goto(FRONTEND_URL, { waitUntil: 'networkidle', timeout: 10000 });
    await page.waitForTimeout(2000);

    console.log(`[WalletAutomation] Credential offer accepted successfully`);
    return { success: true };
  } catch (error: any) {
    return { success: false, error: `Credential issuance failed: ${error.message}` };
  }
}

// =============================================================================
// Credential Offer Acceptance (OID4VCI)
// =============================================================================

export async function acceptCredentialOffer(
  page: Page,
  offerUrl: string,
  options: { txCode?: string; timeoutMs?: number } = {}
): Promise<{ success: boolean; error?: string }> {
  const { txCode, timeoutMs = 30000 } = options;

  try {
    const walletUrl = convertToWalletCallbackUrl(offerUrl);
    await page.goto(walletUrl, { waitUntil: 'networkidle', timeout: timeoutMs });
    await page.waitForTimeout(2000);

    if (txCode) {
      const txCodeInput = page.locator('input[type="text"], input[type="number"]');
      if (await txCodeInput.isVisible({ timeout: 5000 }).catch(() => false)) {
        await txCodeInput.fill(txCode);
        const submitButton = page.locator('button:has-text("Submit"), button:has-text("Send")');
        if (await submitButton.isVisible({ timeout: 2000 })) {
          await submitButton.click();
        }
      }
    }

    await page.waitForTimeout(5000);

    const errorElement = page.locator('[class*="error"], [class*="Error"], [role="alert"]').first();
    const errorText = await errorElement.textContent({ timeout: 2000 }).catch(() => null);
    if (errorText && errorText.toLowerCase().includes('error')) {
      return { success: false, error: errorText };
    }

    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

// =============================================================================
// URL Helpers
// =============================================================================

export function convertToWalletCallbackUrl(url: string, tenantId?: string): string {
  const base = tenantId ? `${FRONTEND_URL}/id/${tenantId}` : FRONTEND_URL;

  if (url.startsWith(FRONTEND_URL)) return url;

  if (url.startsWith('openid-credential-offer://')) {
    const params = url.replace('openid-credential-offer://?', '');
    return `${base}/cb?${params}`;
  }

  if (url.startsWith('openid4vp://')) {
    const params = url.replace('openid4vp://?', '');
    return `${base}/cb?${params}`;
  }

  try {
    const parsed = new URL(url);
    return `${base}/cb?${parsed.searchParams.toString()}`;
  } catch {
    return url;
  }
}
