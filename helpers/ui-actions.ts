/**
 * UI Action Helpers
 *
 * Common UI interactions for WebAuthn registration and login flows.
 */

import { expect, request } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';
const ADMIN_URL = process.env.ADMIN_URL || 'http://localhost:8081';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'e2e-test-admin-token-for-testing-purposes-only';
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8080';

// =============================================================================
// Auth endpoint matching
// =============================================================================
//
// go-wallet-backend serves passkey auth at /auth/passkey/{register,login}/
// {begin,finish} (session mode: `X-Token-Mode: session`, session cookie, no
// token in the body). Older backends/frontends (pinned in older golden
// releases) use /user/{register,login}-webauthn-{begin,finish} instead. The
// legacy URLs are still matched so such releases keep working; once a backend
// has removed the legacy AS it answers those with HTTP 410
// `legacy_tokens_disabled`, which is reported verbatim below.

export type AuthStep = 'begin' | 'finish';

export function isAuthEndpoint(
  url: string,
  flow: 'register' | 'login',
  step: AuthStep
): boolean {
  const path = new URL(url, 'http://placeholder').pathname;
  return (
    path.endsWith(`/auth/passkey/${flow}/${step}`) ||
    path.endsWith(`/user/${flow}-webauthn-${step}`)
  );
}

/** Which auth flow a backend/frontend pair used (from the finish URL). */
export type AuthMode = 'session' | 'legacy';

export function authModeOf(url: string): AuthMode {
  return new URL(url, 'http://placeholder').pathname.includes('/auth/passkey/')
    ? 'session'
    : 'legacy';
}

/** Build a readable error from a failed auth response (incl. HTTP 410). */
async function describeAuthFailure(
  response: { status(): number; json(): Promise<any> },
  fallback: string
): Promise<string> {
  try {
    const data = await response.json();
    const msg = data.error || data.message;
    if (msg) {
      return response.status() === 410
        ? `HTTP 410 ${msg} (backend has removed the legacy HMAC AS; the wallet frontend must use X-Token-Mode: session)`
        : msg;
    }
  } catch { /* not JSON */ }
  return `${fallback}: HTTP ${response.status()}`;
}

// =============================================================================
// Registration
// =============================================================================

export interface RegisterResult {
  success: boolean;
  userId?: string;
  tenantId?: string;
  /** `session` when the AS session-mode endpoints were used. */
  authMode?: AuthMode;
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
  let authMode: AuthMode | undefined;
  let apiError: string | undefined;

  page.on('response', async (response) => {
    const url = response.url();
    if (isAuthEndpoint(url, 'register', 'finish')) {
      if (response.status() === 200) {
        authMode = authModeOf(url);
        try {
          finishResponse = await response.json();
        } catch { /* */ }
      } else {
        apiError = await describeAuthFailure(response, 'Finish failed');
      }
    } else if (isAuthEndpoint(url, 'register', 'begin') && !response.ok()) {
      apiError = await describeAuthFailure(response, 'Begin failed');
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
      (response) => isAuthEndpoint(response.url(), 'register', 'finish'),
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
      authMode,
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
    if (isAuthEndpoint(url, 'login', 'finish')) {
      finishStatus = response.status();
      try {
        finishResponse = await response.json();
      } catch { /* */ }
      if (finishStatus !== 200 && finishStatus !== 409) {
        apiError = await describeAuthFailure(response, 'Finish failed');
      }
    } else if (isAuthEndpoint(url, 'login', 'begin') && !response.ok()) {
      apiError = await describeAuthFailure(response, 'Begin failed');
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
      (response) => isAuthEndpoint(response.url(), 'login', 'finish'),
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

// =============================================================================
// Access tokens (session mode)
// =============================================================================

export interface AccessTokenOptions {
  /** Audience; `wallet-backend` for the general user API. */
  aud?: string;
  /** Tenant the session belongs to. */
  tenantId: string;
  /** Requested permissions (subset of the session's maximum), e.g. `rl`. */
  tac?: string;
  backendUrl?: string;
}

export interface AccessToken {
  accessToken: string;
  tokenType: string;
  expiresIn: number;
}

/**
 * Obtain a short-lived access token (ES256) from `POST /auth/token`, using the
 * session cookie that a prior session-mode registration/login left in the
 * browser context. Use the result as `Authorization: Bearer <accessToken>`
 * for direct backend calls; there is no long-lived app token any more.
 */
export async function requestAccessToken(
  context: BrowserContext,
  options: AccessTokenOptions
): Promise<AccessToken> {
  const body: Record<string, unknown> = {
    aud: options.aud ?? 'wallet-backend',
    tenant_id: options.tenantId,
  };
  if (options.tac) body.tac = options.tac;

  const res = await context.request.post(
    `${options.backendUrl ?? BACKEND_URL}/auth/token`,
    {
      headers: {
        'X-Token-Mode': 'session',
        'X-Tenant-ID': options.tenantId,
      },
      data: body,
    }
  );
  if (!res.ok()) {
    throw new Error(`POST /auth/token failed: HTTP ${res.status()} ${await res.text()}`);
  }
  const data = await res.json();
  if (typeof data.access_token !== 'string' || data.token_type !== 'Bearer') {
    throw new Error(`Unexpected /auth/token response: ${JSON.stringify(data)}`);
  }
  return {
    accessToken: data.access_token,
    tokenType: data.token_type,
    expiresIn: data.expires_in,
  };
}
