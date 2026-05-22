/**
 * WebAuthn Virtual Authenticator Helper
 *
 * Uses Chrome DevTools Protocol (CDP) to create and manage virtual
 * authenticators for testing WebAuthn flows with PRF extension support.
 *
 * Chrome's CDP virtual authenticator reports hasPrf=true but returns
 * empty PRF results. The injectPrfMock() method patches the WebAuthn API
 * to compute actual HMAC-SHA256 based PRF outputs.
 */

import type { Page, CDPSession } from '@playwright/test';

export interface AuthenticatorOptions {
  protocol: 'ctap2' | 'u2f';
  ctap2Version?: 'ctap2_0' | 'ctap2_1';
  transport?: 'usb' | 'nfc' | 'ble' | 'cable' | 'internal';
  hasResidentKey?: boolean;
  hasUserVerification?: boolean;
  isUserVerified?: boolean;
  automaticPresenceSimulation?: boolean;
  hasPrf?: boolean;
  hasLargeBlob?: boolean;
  hasCredBlob?: boolean;
  hasMinPinLength?: boolean;
  defaultBackupEligibility?: boolean;
  defaultBackupState?: boolean;
}

export class WebAuthnHelper {
  private page: Page;
  private cdpSession: CDPSession | null = null;
  private authenticatorId: string | null = null;

  constructor(page: Page) {
    this.page = page;
  }

  async initialize(): Promise<void> {
    const context = this.page.context();
    this.cdpSession = await context.newCDPSession(this.page);
    await this.cdpSession.send('WebAuthn.enable', {
      enableUI: false,
    });
  }

  async addAuthenticator(options: Partial<AuthenticatorOptions> = {}): Promise<string> {
    if (!this.cdpSession) {
      throw new Error('CDP session not initialized. Call initialize() first.');
    }

    const defaultOptions: AuthenticatorOptions = {
      protocol: 'ctap2',
      ctap2Version: 'ctap2_1',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
      hasPrf: true,
    };

    const mergedOptions = { ...defaultOptions, ...options };

    const result = await this.cdpSession.send('WebAuthn.addVirtualAuthenticator', {
      options: mergedOptions as any,
    });

    this.authenticatorId = result.authenticatorId;
    return this.authenticatorId;
  }

  async addPlatformAuthenticator(): Promise<string> {
    return this.addAuthenticator({
      protocol: 'ctap2',
      ctap2Version: 'ctap2_1',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
      hasPrf: true,
    });
  }

  async getCredentials(): Promise<any[]> {
    if (!this.cdpSession || !this.authenticatorId) {
      throw new Error('Authenticator not initialized');
    }

    const result = await this.cdpSession.send('WebAuthn.getCredentials', {
      authenticatorId: this.authenticatorId,
    });

    return result.credentials;
  }

  async addCredential(credential: any): Promise<void> {
    if (!this.cdpSession || !this.authenticatorId) {
      throw new Error('Authenticator not initialized');
    }

    await this.cdpSession.send('WebAuthn.addCredential', {
      authenticatorId: this.authenticatorId,
      credential,
    });
  }

  async clearCredentials(): Promise<void> {
    if (!this.cdpSession || !this.authenticatorId) {
      throw new Error('Authenticator not initialized');
    }

    await this.cdpSession.send('WebAuthn.clearCredentials', {
      authenticatorId: this.authenticatorId,
    });
  }

  async removeAuthenticator(): Promise<void> {
    if (!this.cdpSession || !this.authenticatorId) {
      return;
    }

    await this.cdpSession.send('WebAuthn.removeVirtualAuthenticator', {
      authenticatorId: this.authenticatorId,
    });

    this.authenticatorId = null;
  }

  async cleanup(): Promise<void> {
    if (this.authenticatorId) {
      await this.removeAuthenticator();
    }

    if (this.cdpSession) {
      try {
        await this.cdpSession.send('WebAuthn.disable');
      } catch {
        // Session may already be closed
      }
      await this.cdpSession.detach().catch(() => {});
      this.cdpSession = null;
    }
  }

  async injectPrfMock(): Promise<void> {
    await this.page.addInitScript(() => {
      const credentialPrfSeeds = new Map<string, Uint8Array>();

      const toHex = (buffer: ArrayBuffer): string =>
        Array.from(new Uint8Array(buffer)).map(b => b.toString(16).padStart(2, '0')).join('');

      const generatePrfSeed = async (credentialId: ArrayBuffer): Promise<Uint8Array> => {
        const idString = toHex(credentialId);
        const existing = credentialPrfSeeds.get(idString);
        if (existing) return existing;

        const encoder = new TextEncoder();
        const keyMaterial = await crypto.subtle.digest('SHA-256',
          new Uint8Array([...encoder.encode('prf-mock-seed:'), ...new Uint8Array(credentialId)])
        );
        const seed = new Uint8Array(keyMaterial);
        credentialPrfSeeds.set(idString, seed);
        return seed;
      };

      const computePrfOutput = async (seed: Uint8Array, salt: ArrayBuffer): Promise<ArrayBuffer> => {
        const key = await crypto.subtle.importKey(
          'raw',
          seed.buffer as ArrayBuffer,
          { name: 'HMAC', hash: 'SHA-256' },
          false,
          ['sign']
        );
        return crypto.subtle.sign('HMAC', key, salt);
      };

      const originalCreate = navigator.credentials.create.bind(navigator.credentials);
      (navigator.credentials as any).create = async function(options: CredentialCreationOptions) {
        const credential = await originalCreate(options) as PublicKeyCredential | null;
        if (!credential) return credential;

        const prfInput = (options.publicKey as any)?.extensions?.prf;
        if (!prfInput?.eval?.first) return credential;

        const seed = await generatePrfSeed(credential.rawId);
        const salt = prfInput.eval.first as ArrayBuffer;
        const prfOutput = await computePrfOutput(seed, salt);

        const originalGetClientExtensionResults = credential.getClientExtensionResults.bind(credential);
        (credential as any).getClientExtensionResults = function() {
          const results = originalGetClientExtensionResults();
          results.prf = {
            enabled: true,
            results: { first: prfOutput },
          };
          return results;
        };

        return credential;
      };

      const originalGet = navigator.credentials.get.bind(navigator.credentials);
      (navigator.credentials as any).get = async function(options: CredentialRequestOptions) {
        const credential = await originalGet(options) as PublicKeyCredential | null;
        if (!credential) return credential;

        const prfInput = (options.publicKey as any)?.extensions?.prf;
        if (!prfInput) return credential;

        const seed = await generatePrfSeed(credential.rawId);

        let salt: ArrayBuffer | null = null;

        if (prfInput.eval?.first) {
          salt = prfInput.eval.first as ArrayBuffer;
        } else if (prfInput.evalByCredential) {
          const credIdB64 = btoa(String.fromCharCode(...new Uint8Array(credential.rawId)))
            .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
          const credSalt = prfInput.evalByCredential[credIdB64];
          if (credSalt?.first) {
            salt = credSalt.first as ArrayBuffer;
          }
        }

        if (!salt) return credential;

        const prfOutput = await computePrfOutput(seed, salt);

        const originalGetClientExtensionResults = credential.getClientExtensionResults.bind(credential);
        (credential as any).getClientExtensionResults = function() {
          const results = originalGetClientExtensionResults();
          results.prf = {
            enabled: true,
            results: { first: prfOutput },
          };
          return results;
        };

        return credential;
      };
    });
  }

  getAuthenticatorId(): string | null {
    return this.authenticatorId;
  }
}

// =============================================================================
// Utilities
// =============================================================================

export function generateTestUsername(prefix = 'test-user'): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `${prefix}-${timestamp}-${random}`;
}
