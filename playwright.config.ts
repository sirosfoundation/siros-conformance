import { defineConfig, devices } from '@playwright/test';

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

export default defineConfig({
  testDir: './specs',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [
    ['html', { open: 'never' }],
    ['list'],
  ],

  use: {
    baseURL: FRONTEND_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    ignoreHTTPSErrors: true,
    storageState: undefined,
  },

  timeout: 300000,

  expect: {
    timeout: 10000,
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chrome',
        launchOptions: {
          args: [
            '--enable-experimental-web-platform-features',
            '--disable-web-security',
            '--allow-insecure-localhost',
            '--disable-gpu',
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            // issuer-core conformance: the wallet-initiated modules expose
            // a redirect to the issuer's Docker-network alias
            // (issuer.conformance.example.com); the browser runs on the
            // host, which cannot resolve it. MAP it to the published TLS
            // proxy port. Inert for other specs: the hostname resolves
            // nowhere else.
            '--host-resolver-rules=MAP issuer.conformance.example.com 127.0.0.1',
          ],
        },
      },
    },
  ],
});
