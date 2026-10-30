import { defineConfig } from '@playwright/test';
import base from './playwright.config.js';

export default defineConfig({
  ...base,
  testMatch: 'sharing.spec.js',
  workers: 2,
  use: { ...base.use, baseURL: 'http://127.0.0.1:5180' },
  webServer: [
    { command: 'npm run start', url: 'http://127.0.0.1:3001/api/session', reuseExistingServer: false, env: { NODE_ENV: 'development', APP_ORIGIN: 'http://127.0.0.1:5180', PORT: '3001', HOST: '127.0.0.1', DATA_DIR: `/tmp/sideline-sharing-test-${process.pid}` } },
    { command: 'npm run dev:shared -- --port 5180 --strictPort', url: 'http://127.0.0.1:5180', reuseExistingServer: false },
  ],
});
