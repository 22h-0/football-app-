import { defineConfig } from '@playwright/test';
import base from './playwright.config.js';

// Every run gets a fresh local D1 database; the Worker bootstraps its initial
// schema just as it does after automatic provisioning. Commands never contact
// a remote database or require a Cloudflare account/token.
const persistence = `/tmp/sideline-cf-e2e-${process.pid}`;

export default defineConfig({
  ...base,
  testMatch: 'cloudflare.spec.js',
  workers: 1,
  retries: 0,
  use: { ...base.use, baseURL: 'http://localhost:8787' },
  webServer: {
    // Wrangler performs build:shared through wrangler.jsonc's build.command.
    command: `npx wrangler dev --local --ip 127.0.0.1 --port 8787 --persist-to ${persistence}`,
    url: 'http://127.0.0.1:8787/api/session',
    reuseExistingServer: false,
    timeout: 120_000,
    env: { CI: 'true', WRANGLER_SEND_METRICS: 'false', XDG_CONFIG_HOME: `${persistence}/config`, WRANGLER_LOG_PATH: `${persistence}/wrangler.log` },
  },
});
