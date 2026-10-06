import { defineConfig } from '@playwright/test';

// Porta insolita e nessun riuso: la 4173 (default di vite preview) può essere occupata da altre app locali
// I test girano sulla build "e2e" servita da vite preview, con il Chrome già installato (nessun browser da scaricare)
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4391',
    channel: 'chrome',
    viewport: { width: 1400, height: 800 },
    // Il service worker non serve ai test e manterrebbe in cache versioni vecchie
    serviceWorkers: 'block',
    // WebGL software anche in modalità headless
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run build:e2e && npx vite preview --outDir dist-e2e --port 4391 --strictPort',
    url: 'http://localhost:4391',
    timeout: 180_000,
    reuseExistingServer: false,
  },
});
