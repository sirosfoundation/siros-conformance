/**
 * ADB Wallet Helper — Drive the Android sample-app via ADB for conformance tests.
 *
 * Sends deep-link intents (`openid-credential-offer://`, `openid4vp://`)
 * and monitors logcat for flow completion/error signals.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const ANDROID_HOME = process.env.ANDROID_HOME || `${process.env.HOME}/Android/Sdk`;
const ADB = process.env.ADB_PATH || `${ANDROID_HOME}/platform-tools/adb`;
const PACKAGE = 'org.sirosfoundation.sdk.sample';
const ACTIVITY = `${PACKAGE}/.MainActivity`;

const ADB_TIMEOUT = 10_000; // ms for individual adb commands

export interface AdbWalletOptions {
  /** Waydroid IP for adb connect (default: 192.168.240.112) */
  waydroidIp?: string;
  /** Timeout waiting for flow completion in logcat (default: 60s) */
  flowTimeoutMs?: number;
}

export class AdbWalletHelper {
  private waydroidIp: string;
  private flowTimeoutMs: number;
  private connected = false;

  constructor(options: AdbWalletOptions = {}) {
    this.waydroidIp = options.waydroidIp || process.env.WAYDROID_IP || '192.168.240.112';
    this.flowTimeoutMs = options.flowTimeoutMs || 60_000;
  }

  // ── ADB primitives ──────────────────────────────────────────────────────

  private async adb(...args: string[]): Promise<string> {
    const { stdout, stderr } = await execFileAsync(ADB, args, {
      timeout: ADB_TIMEOUT,
    });
    return (stdout || '').trim();
  }

  /** Ensure ADB is connected (Waydroid or physical device). */
  async connect(): Promise<void> {
    if (this.connected) return;

    try {
      const state = await this.adb('get-state');
      if (state === 'device') {
        this.connected = true;
        return;
      }
    } catch {
      // Not connected yet
    }

    await this.adb('connect', `${this.waydroidIp}:5555`).catch(() => {});
    await new Promise((r) => setTimeout(r, 1000));

    const state = await this.adb('get-state');
    if (state !== 'device') {
      throw new Error(`ADB not connected (state=${state}). Is Waydroid running?`);
    }
    this.connected = true;
  }

  /** Check if the sample-app is installed. */
  async isAppInstalled(): Promise<boolean> {
    try {
      const result = await this.adb('shell', 'pm', 'list', 'packages', PACKAGE);
      return result.includes(PACKAGE);
    } catch {
      return false;
    }
  }

  /** Launch the sample-app. */
  async launchApp(): Promise<void> {
    await this.adb('shell', 'am', 'force-stop', PACKAGE).catch(() => {});
    await this.adb('shell', 'am', 'start', '-n', ACTIVITY);
    await new Promise((r) => setTimeout(r, 3000));
  }

  /** Clear logcat buffer. */
  async clearLogcat(): Promise<void> {
    await this.adb('logcat', '-c');
  }

  // ── Deep-link dispatch ───────────────────────────────────────────────────

  /**
   * Send a credential offer deep link to the sample-app.
   *
   * @param offerUrl Full `openid-credential-offer://...` URL
   */
  async sendCredentialOffer(offerUrl: string): Promise<void> {
    await this.adb(
      'shell', 'am', 'start',
      '-a', 'android.intent.action.VIEW',
      '-d', offerUrl,
      '-n', ACTIVITY,
    );
  }

  /**
   * Send a VP presentation request deep link to the sample-app.
   *
   * @param vpUrl Full `openid4vp://...` URL
   */
  async sendPresentationRequest(vpUrl: string): Promise<void> {
    await this.adb(
      'shell', 'am', 'start',
      '-a', 'android.intent.action.VIEW',
      '-d', vpUrl,
      '-n', ACTIVITY,
    );
  }

  /**
   * Send an arbitrary deep-link URI. Auto-detects the scheme.
   */
  async sendDeepLink(url: string): Promise<void> {
    if (url.startsWith('openid-credential-offer://') || url.startsWith('openid-credential-offer:')) {
      return this.sendCredentialOffer(url);
    }
    if (url.startsWith('openid4vp://') || url.startsWith('openid4vp:')) {
      return this.sendPresentationRequest(url);
    }
    // Generic fallback
    await this.adb(
      'shell', 'am', 'start',
      '-a', 'android.intent.action.VIEW',
      '-d', url,
    );
  }

  // ── Logcat monitoring ────────────────────────────────────────────────────

  /**
   * Wait for a flow completion signal in logcat.
   *
   * Watches for log lines matching completion/error patterns from the SDK.
   * Returns the matching log line.
   */
  async waitForFlowCompletion(timeoutMs?: number): Promise<{ success: boolean; message: string }> {
    const timeout = timeoutMs || this.flowTimeoutMs;
    const deadline = Date.now() + timeout;

    // Patterns the sample-app / SDK logs on flow completion or error
    const successPatterns = [
      /flow.*complete/i,
      /credential.*stored/i,
      /credential.*accepted/i,
      /presentation.*sent/i,
      /vp.*response.*sent/i,
      /issuance.*success/i,
    ];
    const errorPatterns = [
      /flow.*error/i,
      /flow.*failed/i,
      /credential.*error/i,
      /presentation.*error/i,
      /issuance.*failed/i,
    ];

    while (Date.now() < deadline) {
      try {
        const output = await this.adb(
          'logcat', '-d', '-t', '50',
          '-s', 'SIROS_VM:*', 'SirosSDK:*',
        );

        for (const line of output.split('\n')) {
          for (const pattern of successPatterns) {
            if (pattern.test(line)) {
              return { success: true, message: line.trim() };
            }
          }
          for (const pattern of errorPatterns) {
            if (pattern.test(line)) {
              return { success: false, message: line.trim() };
            }
          }
        }
      } catch {
        // logcat read failed, retry
      }

      await new Promise((r) => setTimeout(r, 2000));
    }

    return { success: false, message: `Timed out after ${timeout}ms waiting for flow completion` };
  }

  /**
   * Get a recent logcat snapshot filtered for SIROS-related output.
   */
  async getRecentLogs(lines = 100): Promise<string> {
    try {
      return await this.adb(
        'logcat', '-d', '-t', String(lines),
      );
    } catch {
      return '(logcat unavailable)';
    }
  }

  /** Disconnect ADB. */
  async cleanup(): Promise<void> {
    this.connected = false;
  }
}
