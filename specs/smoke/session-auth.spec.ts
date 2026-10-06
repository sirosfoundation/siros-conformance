/**
 * Session-mode auth smoke test
 *
 * Guards the harness's own registration/login helpers against the backend's
 * auth contract: passkey registration and login through the UI (CDP virtual
 * authenticator), then an ES256 access token from `POST /auth/token` using the
 * session cookie. Backends/frontends that still use the legacy
 * /user/*-webauthn-* flow (older golden releases) are detected from the URL
 * the frontend called; the token step is only required for session mode.
 *
 * Needs the wallet stack only (no conformance suite): `make up-wallet`.
 */

import { test, expect } from '@playwright/test';
import { createTenant, deleteTenant, generateTestId } from '../../helpers/shared-helpers';
import { registerUserViaUI, loginUserViaUI, requestAccessToken } from '../../helpers/ui-actions';
import { generateTestUsername, WebAuthnHelper } from '../../helpers/webauthn';

test('register, log in and obtain an access token (session mode)', async ({ browser }) => {
  const tenantId = generateTestId('auth');
  const username = generateTestUsername('auth');
  await createTenant(tenantId, `Auth smoke ${tenantId}`);

  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    const webauthn = new WebAuthnHelper(page);
    await webauthn.initialize();
    await webauthn.injectPrfMock();
    await webauthn.addPlatformAuthenticator();

    const reg = await registerUserViaUI(page, { username, tenantId });
    expect(reg.error, 'registration error').toBeUndefined();
    expect(reg.success).toBe(true);
    expect(reg.userId).toBeTruthy();
    expect(reg.tenantId).toBe(tenantId);

    if (reg.authMode === 'session') {
      const token = await requestAccessToken(context, { tenantId, tac: 'rl' });
      expect(token.tokenType).toBe('Bearer');
      expect(token.expiresIn).toBeGreaterThan(0);

      // Asymmetric (ES256) JWT carrying the session's identity.
      const [h, p] = token.accessToken.split('.');
      const header = JSON.parse(Buffer.from(h, 'base64url').toString());
      const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
      expect(header.alg).toBe('ES256');
      expect(payload.sub).toBe(reg.userId);
      expect(payload.tenant_id).toBe(tenantId);
      expect(payload.aud).toBe('wallet-backend');
    }

    // Fresh page, same authenticator: log in again through the UI.
    const loginPage = await context.newPage();
    const loginWebauthn = new WebAuthnHelper(loginPage);
    await loginWebauthn.initialize();
    await loginWebauthn.injectPrfMock();
    await loginWebauthn.addPlatformAuthenticator();
    await loginWebauthn.addCredential((await webauthn.getCredentials())[0]);
    const login = await loginUserViaUI(loginPage, { tenantId });
    expect(login.error, 'login error').toBeUndefined();
    expect(login.success).toBe(true);
    expect(login.userId).toBe(reg.userId);
  } finally {
    await context.close();
    await deleteTenant(tenantId);
  }
});
