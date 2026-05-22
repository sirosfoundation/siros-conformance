/**
 * Shared Helper Functions
 */

import { expect, request } from '@playwright/test';

// =============================================================================
// Environment Configuration
// =============================================================================

export const ENV = {
  FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:3000',
  BACKEND_URL: process.env.BACKEND_URL || 'http://localhost:8080',
  ENGINE_URL: process.env.ENGINE_URL || 'http://localhost:8082',
  ADMIN_URL: process.env.ADMIN_URL || 'http://localhost:8081',
  ISSUER_URL: process.env.ISSUER_URL || 'http://localhost:9000',
  VERIFIER_URL: process.env.VERIFIER_URL || 'http://localhost:9001',
  ADMIN_TOKEN: process.env.ADMIN_TOKEN || 'e2e-test-admin-token-for-testing-purposes-only',
};

// =============================================================================
// ID Generation
// =============================================================================

export function generateTestId(prefix = 'test'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// =============================================================================
// Tenant Management
// =============================================================================

export async function createTenant(tenantId: string, name?: string): Promise<void> {
  const adminApi = await request.newContext({
    extraHTTPHeaders: { Authorization: `Bearer ${ENV.ADMIN_TOKEN}` },
  });
  const response = await adminApi.post(`${ENV.ADMIN_URL}/admin/tenants`, {
    data: { id: tenantId, name: name || `Test Tenant ${tenantId}` },
  });
  expect(response.ok()).toBe(true);
  await adminApi.dispose();
}

export async function deleteTenant(tenantId: string): Promise<void> {
  try {
    const adminApi = await request.newContext({
      extraHTTPHeaders: { Authorization: `Bearer ${ENV.ADMIN_TOKEN}` },
    });
    await adminApi.delete(`${ENV.ADMIN_URL}/admin/tenants/${tenantId}`);
    await adminApi.dispose();
  } catch {
    // Ignore cleanup errors
  }
}
