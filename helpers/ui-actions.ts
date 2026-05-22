/**
 * UI Action Helpers
 *
 * Common UI interactions for WebAuthn registration and login flows.
 */

import { expect, request } from '@playwright/test';
import type { Page } from '@playwright/test';

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';
const ADMIN_URL = process.env.ADMIN_URL || 'http://localhost:8081';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'e2e-test-admin-token-for-testing-purposes-only';

// =============================================================================
// Registration
// =============================================================================

export interface RegisterResult {
  success: boolean;
  userId?: string;
  tenantId?: string;
  appToken?: string;
  error?: string;
}

export interface RegisterOptions {
  username: string;
  tenantId?: string;
}

export async function registerUserViaUI(
  page: Page,
  options: RegisterOptions
): Promise<RegisterResult> {
  const effectiveTenantId = options.tenantId || 'default';
  const loginUrl = `${FRONTEND_URL}/id/${effectiveTenantId}/login`;

  await page.goto(loginUrl);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);

  let finishResponse: any = null;
  let apiError: string | undefined;

  page.on('response', async (response) => {
    const url = response.url();
    if (url.includes('register-webauthn-finish')) {
      try {
        const data = await response.json();
        if (response.status() === 200) {
          finishResponse = data;
        } else {
          apiError = data.error || `HTTP ${response.status()}`;
        }
      } catch { /* */ }
    } else if (url.includes('register-webauthn-begin') && !response.ok()) {
      try {
        const data = await response.json();
        apiError = data.error || `Begin failed: HTTP ${response.status()}`;
      } catch {
        apiError = `Begin failed: HTTP ${response.status()}`;
      }
    }
  });

  // Switch to signup
  const signUpSwitch = page.locator('#signUp-switch-loginsignup');
  if (await signUpSwitch.isVisible({ timeout: 5000 }).catch(() => false)) {
    await signUpSwitch.click();
    await page.waitForTimeout(500);
  }

  // Fill username
  const nameInput = page.locator('input[name="name"]');
  await expect(nameInput).toBeVisible({ timeout: 10000 });
  await nameInput.fill(options.username);

  // Click signup
  const unifiedSignupButton = page.locator('button:has-text("Create account with a Passkey")');
  const legacySignupButton = page.locator('[id*="signUpPasskey"][id*="security-key"][id*="submit"]');
  let signupButton;
  if (await unifiedSignupButton.isVisible({ timeout: 3000 }).catch(() => false)) {
    signupButton = unifiedSignupButton;
  } else {
    signupButton = legacySignupButton;
    await expect(signupButton).toBeVisible({ timeout: 10000 });
  }

  const WEBAUTHN_TIMEOUT = 20000;

  try {
    const responsePromise = page.waitForResponse(
      (response) => response.url().includes('register-webauthn-finish'),
      { timeout: WEBAUTHN_TIMEOUT * 2 }
    );

    await signupButton.click();
    await page.waitForTimeout(3000);

    const continueButton = page.locator('button:has-text("Continue")');
    if (await continueButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await continueButton.click();
    }

    await Promise.race([
      responsePromise,
      page.waitForTimeout(WEBAUTHN_TIMEOUT).then(() => {
        throw new Error('WebAuthn operation timed out');
      }),
    ]);
  } catch (error) {
    if (apiError) return { success: false, error: apiError };
    return { success: false, error: String(error) };
  }

  await page.waitForTimeout(500);

  if (finishResponse) {
    return {
      success: true,
      userId: finishResponse.uuid,
      tenantId: finishResponse.tenantId || 'default',
      appToken: finishResponse.appToken,
    };
  }

  if (apiError) return { success: false, error: apiError };
  return { success: false, error: 'No finish response captured' };
}

// =============================================================================
// Login
// =============================================================================

export interface LoginResult {
  success: boolean;
  userId?: string;
  tenantId?: string;
  error?: string;
  status?: number;
}

export interface LoginOptions {
  tenantId?: string;
  expectCachedUser?: boolean;
  cachedUserIndex?: number;
}

export async function loginUserViaUI(
  page: Page,
  options: LoginOptions = {}
): Promise<LoginResult> {
  const effectiveTenantId = options.tenantId || 'default';
  const loginUrl = `${FRONTEND_URL}/id/${effectiveTenantId}/login`;

  await page.goto(loginUrl);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);

  let finishResponse: any = null;
  let finishStatus: number | undefined;
  let apiError: string | undefined;

  page.on('response', async (response) => {
    const url = response.url();
    if (url.includes('login-webauthn-finish')) {
      finishStatus = response.status();
      try {
        finishResponse = await response.json();
      } catch { /* */ }
    } else if (url.includes('login-webauthn-begin') && !response.ok()) {
      try {
        const data = await response.json();
        apiError = data.error || `Begin failed: HTTP ${response.status()}`;
      } catch {
        apiError = `Begin failed: HTTP ${response.status()}`;
      }
    }
  });

  // Find login button
  let loginButton;
  if (options.expectCachedUser !== false) {
    const cachedIndex = options.cachedUserIndex ?? 0;
    const cachedUserButton = page.locator(`#login-cached-user-${cachedIndex}-loginsignup`);
    if (await cachedUserButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      loginButton = cachedUserButton;
    }
  }

  if (!loginButton) {
    const unifiedLoginButton = page.locator('button:has-text("Log in with a Passkey")');
    if (await unifiedLoginButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      loginButton = unifiedLoginButton;
    } else {
      loginButton = page.locator('#loginPasskey-security-key-submit-loginsignup');
    }
  }

  await expect(loginButton).toBeVisible({ timeout: 15000 });

  const WEBAUTHN_TIMEOUT = 15000;

  try {
    const responsePromise = page.waitForResponse(
      (response) => response.url().includes('login-webauthn-finish'),
      { timeout: WEBAUTHN_TIMEOUT }
    );

    await loginButton.click();

    await Promise.race([
      responsePromise,
      page.waitForTimeout(WEBAUTHN_TIMEOUT).then(() => {
        throw new Error('WebAuthn operation timed out');
      }),
    ]);
  } catch (error) {
    await page.waitForTimeout(500);

    if (finishResponse && finishStatus === 409) {
      return {
        success: false,
        status: 409,
        error: finishResponse.error,
        userId: finishResponse.user_id,
      };
    }

    if (apiError) return { success: false, error: apiError };
    return { success: false, error: String(error) };
  }

  await page.waitForTimeout(500);

  if (finishResponse) {
    if (finishStatus === 200) {
      return {
        success: true,
        status: 200,
        userId: finishResponse.uuid,
        tenantId: finishResponse.tenantId,
      };
    } else if (finishStatus === 409) {
      return {
        success: false,
        status: 409,
        error: finishResponse.error,
        userId: finishResponse.user_id,
      };
    }
  }

  if (apiError) return { success: false, error: apiError };
  return { success: false, error: 'No finish response captured' };
}
