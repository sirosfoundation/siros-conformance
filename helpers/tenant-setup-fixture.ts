/**
 * Tenant Setup Fixture for Playwright Tests
 *
 * Creates a tenant and registers a user via the UI with a CDP virtual
 * authenticator, shared across all tests in a worker.
 */

import { test as base } from '@playwright/test';
import { createTenant, deleteTenant, generateTestId } from './shared-helpers';
import { registerUserViaUI } from './ui-actions';
import { generateTestUsername } from './webauthn';
import { WebAuthnHelper } from './webauthn';

export interface TenantContext {
  tenantId: string;
  username: string;
  userId?: string;
  appToken?: string;
  ready: boolean;
  error?: string;
  credentials?: any[];
}

export const test = base.extend<{}, { tenantContext: TenantContext }>({
  tenantContext: [async ({ browser }, use) => {
    const ctx: TenantContext = {
      tenantId: '',
      username: '',
      ready: false,
    };

    ctx.tenantId = generateTestId('conf');
    ctx.username = generateTestUsername('conf');
    await createTenant(ctx.tenantId, `Conformance ${ctx.tenantId}`);

    const page = await browser.newPage();
    try {
      const webauthn = new WebAuthnHelper(page);
      await webauthn.initialize();
      await webauthn.injectPrfMock();
      await webauthn.addPlatformAuthenticator();

      const regResult = await registerUserViaUI(page, {
        username: ctx.username,
        tenantId: ctx.tenantId,
      });

      if (!regResult.success) {
        ctx.error = `Registration failed: ${regResult.error}`;
        await use(ctx);
        await deleteTenant(ctx.tenantId).catch(() => {});
        return;
      }

      ctx.userId = regResult.userId;
      ctx.appToken = regResult.appToken;
      ctx.ready = true;
      ctx.credentials = await webauthn.getCredentials();
      console.log(`[TenantFixture] Registered user: ${ctx.username} (${ctx.userId}) in tenant ${ctx.tenantId}`);

      await webauthn.cleanup();
    } finally {
      await page.close();
    }

    await use(ctx);

    await deleteTenant(ctx.tenantId).catch(() => {});
    console.log(`[TenantFixture] Cleaned up tenant ${ctx.tenantId}`);
  }, { scope: 'worker' }],
});

export { expect } from '@playwright/test';
