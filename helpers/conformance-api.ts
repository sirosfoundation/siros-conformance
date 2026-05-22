/**
 * OpenID Conformance Suite API Client
 *
 * TypeScript client for the OpenID Foundation Conformance Suite REST API.
 *
 * Usage:
 *   const api = new ConformanceAPI('https://localhost.emobix.co.uk:8443');
 *   await api.waitForServerReady();
 *   const plan = await api.createTestPlan('oid4vp-1final-wallet-test-plan', configJson, variant);
 *   const module = await api.createTestFromPlan(plan.id, 'oid4vp-1final-wallet-happy-flow');
 *   const state = await api.waitForState(module.id, ['WAITING', 'FINISHED']);
 *   await api.exportPlanResults(plan.id, './conformance-results');
 */

import * as fs from 'fs';
import * as path from 'path';

// =============================================================================
// Configuration
// =============================================================================

export const CONFORMANCE_ENV = {
  CONFORMANCE_URL: process.env.CONFORMANCE_URL || 'https://localhost.emobix.co.uk:8443/',
  CONFORMANCE_TOKEN: process.env.CONFORMANCE_TOKEN || '',
};

if (!CONFORMANCE_ENV.CONFORMANCE_URL.endsWith('/')) {
  CONFORMANCE_ENV.CONFORMANCE_URL += '/';
}

// =============================================================================
// Types
// =============================================================================

export interface TestPlanInfo {
  id: string;
  modules: TestModuleEntry[];
  [key: string]: unknown;
}

export interface TestModuleEntry {
  testModule: string;
  variant?: Record<string, string>;
  [key: string]: unknown;
}

export interface TestModuleInfo {
  id: string;
  testId?: string;
  testName?: string;
  status?: string;
  result?: string;
  [key: string]: unknown;
}

export interface ModuleInfo {
  id: string;
  testName: string;
  status: string;
  result: string;
  variant?: Record<string, string>;
  [key: string]: unknown;
}

export interface LogEntry {
  src?: string;
  msg?: string;
  result?: string;
  blockId?: string;
  startBlock?: boolean;
  [key: string]: unknown;
}

export type TestState = 'CREATED' | 'CONFIGURED' | 'WAITING' | 'RUNNING' | 'FINISHED' | 'INTERRUPTED';

// =============================================================================
// API Client
// =============================================================================

export class ConformanceAPI {
  private baseUrl: string;
  private headers: Record<string, string>;

  constructor(baseUrl?: string, token?: string) {
    this.baseUrl = baseUrl || CONFORMANCE_ENV.CONFORMANCE_URL;
    if (!this.baseUrl.endsWith('/')) {
      this.baseUrl += '/';
    }

    this.headers = { 'Content-Type': 'application/json' };
    const apiToken = token || CONFORMANCE_ENV.CONFORMANCE_TOKEN;
    if (apiToken) {
      this.headers['Authorization'] = `Bearer ${apiToken}`;
    }
  }

  private async request(
    method: string,
    url: string,
    options: {
      body?: string;
      params?: Record<string, string>;
      expectedStatus?: number;
      timeout?: number;
      rawResponse?: boolean;
    } = {}
  ): Promise<any> {
    const { body, params, expectedStatus, timeout = 20000, rawResponse = false } = options;

    let fullUrl = url;
    if (params && Object.keys(params).length > 0) {
      const searchParams = new URLSearchParams(params);
      fullUrl += (fullUrl.includes('?') ? '&' : '?') + searchParams.toString();
    }

    const maxAttempts = 3;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        const fetchOptions: RequestInit = {
          method,
          headers: { ...this.headers },
          signal: controller.signal,
        };

        if (body) {
          fetchOptions.body = body;
        }

        const response = await fetch(fullUrl, fetchOptions);
        clearTimeout(timeoutId);

        if (expectedStatus !== undefined && response.status !== expectedStatus) {
          const text = await response.text().catch(() => '');
          if (response.status >= 500 && attempt < maxAttempts) {
            console.log(`[ConformanceAPI] ${method} ${fullUrl} returned ${response.status}, retrying (attempt ${attempt})`);
            await this.sleep(2000 * attempt);
            continue;
          }
          throw new Error(
            `${method} ${url} failed: HTTP ${response.status} - ${text.slice(0, 200)}`
          );
        }

        if (rawResponse) {
          return response;
        }

        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          return await response.json();
        }
        return await response.text();
      } catch (error: any) {
        lastError = error;
        if (error.name === 'AbortError') {
          throw new Error(`${method} ${url} timed out after ${timeout}ms`);
        }
        if (attempt < maxAttempts) {
          console.log(`[ConformanceAPI] ${method} ${fullUrl} failed (attempt ${attempt}): ${error.message}`);
          await this.sleep(2000 * attempt);
          continue;
        }
      }
    }
    throw lastError || new Error(`${method} ${url} failed after ${maxAttempts} attempts`);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ===========================================================================
  // Server Status
  // ===========================================================================

  async waitForServerReady(timeoutMs = 120000): Promise<void> {
    const startTime = Date.now();
    let attempt = 0;

    while (Date.now() - startTime < timeoutMs) {
      attempt++;
      try {
        const url = `${this.baseUrl}api/runner/available`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        const response = await fetch(url, {
          headers: this.headers,
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        if (response.status === 200) {
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
          console.log(`[ConformanceAPI] Server ready after ${elapsed}s (${attempt} attempts)`);
          return;
        }
        console.log(`[ConformanceAPI] Server returned ${response.status} (attempt ${attempt})`);
      } catch (error: any) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
        console.log(`[ConformanceAPI] Server not ready (attempt ${attempt}, ${elapsed}s): ${error.message}`);
      }

      await this.sleep(5000);
    }

    throw new Error(`Conformance suite did not become ready within ${timeoutMs}ms`);
  }

  async getAllTestModules(): Promise<any[]> {
    return await this.request('GET', `${this.baseUrl}api/runner/available`, {
      expectedStatus: 200,
    });
  }

  // ===========================================================================
  // Test Plan Management
  // ===========================================================================

  async createTestPlan(
    planName: string,
    configuration: string,
    variant?: Record<string, string>
  ): Promise<TestPlanInfo> {
    const params: Record<string, string> = { planName };
    if (variant) {
      params['variant'] = JSON.stringify(variant);
    }

    return await this.request('POST', `${this.baseUrl}api/plan`, {
      params,
      body: configuration,
      expectedStatus: 201,
    });
  }

  // ===========================================================================
  // Test Module Management
  // ===========================================================================

  async createTestFromPlan(planId: string, testName: string): Promise<TestModuleInfo> {
    return await this.request('POST', `${this.baseUrl}api/runner`, {
      params: { test: testName, plan: planId },
      expectedStatus: 201,
    });
  }

  async createTestFromPlanWithVariant(
    planId: string,
    testName: string,
    variant?: Record<string, string>
  ): Promise<TestModuleInfo> {
    const params: Record<string, string> = { test: testName, plan: planId };
    if (variant) {
      params['variant'] = JSON.stringify(variant);
    }

    return await this.request('POST', `${this.baseUrl}api/runner`, {
      params,
      expectedStatus: 201,
    });
  }

  async startTest(moduleId: string): Promise<any> {
    return await this.request('POST', `${this.baseUrl}api/runner/${moduleId}`, {
      expectedStatus: 200,
    });
  }

  // ===========================================================================
  // Test Status & Results
  // ===========================================================================

  async getModuleInfo(moduleId: string): Promise<ModuleInfo> {
    return await this.request('GET', `${this.baseUrl}api/info/${moduleId}`, {
      expectedStatus: 200,
    });
  }

  async getTestLog(moduleId: string): Promise<LogEntry[]> {
    return await this.request('GET', `${this.baseUrl}api/log/${moduleId}`, {
      expectedStatus: 200,
    });
  }

  async waitForState(
    moduleId: string,
    requiredStates: TestState[],
    timeoutMs = 240000
  ): Promise<TestState> {
    const deadline = Date.now() + timeoutMs;
    let lastStatus: string | null = null;
    const pollInterval = 1000;

    while (Date.now() < deadline) {
      const info = await this.getModuleInfo(moduleId);
      const status = info.status as TestState;

      if (status !== lastStatus) {
        console.log(`[ConformanceAPI] Module ${moduleId} status: ${status}`);
        lastStatus = status;
      }

      if (requiredStates.includes(status)) {
        return status;
      }

      if (status === 'INTERRUPTED') {
        throw new Error(`Test module ${moduleId} was interrupted`);
      }

      await this.sleep(pollInterval);
    }

    throw new Error(
      `Timed out waiting for module ${moduleId} to reach ${requiredStates.join('|')} (last: ${lastStatus})`
    );
  }

  // ===========================================================================
  // Report Export
  // ===========================================================================

  /**
   * Export the HTML report for a test plan as a ZIP file.
   *
   * Calls GET /api/plan/exporthtml/{planId} which returns a ZIP archive
   * containing the full HTML report and per-module test logs.
   *
   * @param planId - The test plan ID
   * @param outputDir - Directory to save the ZIP file
   * @returns Path to the saved ZIP file
   */
  async exportPlanResults(planId: string, outputDir: string): Promise<string> {
    const url = `${this.baseUrl}api/plan/exporthtml/${planId}`;
    console.log(`[ConformanceAPI] Exporting plan results: ${url}`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);

    try {
      const response = await fetch(url, {
        headers: this.headers,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`Export failed: HTTP ${response.status} - ${text.slice(0, 200)}`);
      }

      const buffer = await response.arrayBuffer();

      fs.mkdirSync(outputDir, { recursive: true });

      const filename = `conformance-report-${planId}.zip`;
      const outputPath = path.join(outputDir, filename);
      fs.writeFileSync(outputPath, Buffer.from(buffer));

      const sizeKB = (buffer.byteLength / 1024).toFixed(1);
      console.log(`[ConformanceAPI] Exported ${sizeKB}KB to ${outputPath}`);

      return outputPath;
    } catch (error: any) {
      if (error.name === 'AbortError') {
        throw new Error(`Export timed out for plan ${planId}`);
      }
      throw error;
    }
  }

  // ===========================================================================
  // Convenience Helpers
  // ===========================================================================

  getLogDetailUrl(moduleId: string): string {
    return `${this.baseUrl}log-detail.html?log=${moduleId}`;
  }

  getPlanDetailUrl(planId: string): string {
    return `${this.baseUrl}plan-detail.html?plan=${planId}`;
  }

  async getWalletInteractionUrl(moduleId: string): Promise<string | null> {
    const logs = await this.getTestLog(moduleId);

    for (const entry of logs) {
      const msg = entry.msg || '';

      if ((entry as any).credential_offer_redirect_url) {
        return (entry as any).credential_offer_redirect_url;
      }

      if ((entry as any).redirect_to_authorization_endpoint) {
        return (entry as any).redirect_to_authorization_endpoint;
      }

      if (msg.includes('request_uri=') || msg.includes('client_id=')) {
        const match = msg.match(/https?:\/\/[^\s"']+request_uri=[^\s"']+/);
        if (match) return match[0];
      }

      if (msg.includes('credential_offer_uri=') || msg.includes('openid-credential-offer')) {
        const match = msg.match(/(openid-credential-offer:\/\/[^\s"']+|https?:\/\/[^\s"']+credential_offer[^\s"']+)/);
        if (match) return match[0];
      }
    }

    const info = await this.getModuleInfo(moduleId);
    if (info && typeof info === 'object') {
      const exposed = (info as any).exposed;
      if (exposed) {
        for (const [_key, value] of Object.entries(exposed)) {
          if (typeof value === 'string' && (
            value.includes('request_uri') ||
            value.includes('credential_offer') ||
            value.includes('openid-credential-offer')
          )) {
            return value;
          }
        }
      }
    }

    return null;
  }

  async getBrowserInteractionUrl(moduleId: string): Promise<string | null> {
    const info = await this.getModuleInfo(moduleId);
    const urls = (info as any).urls;
    if (urls) {
      for (const urlEntry of Object.values(urls)) {
        if (typeof urlEntry === 'string' && urlEntry.includes('/test/')) {
          return urlEntry;
        }
      }
    }

    const alias = (info as any).alias;
    if (alias) {
      return `${this.baseUrl}test/a/${alias}/authorize`;
    }

    return null;
  }
}
