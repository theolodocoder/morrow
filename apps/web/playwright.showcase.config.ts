import { defineConfig } from '@playwright/test'

/**
 * Product screenshots and mockups for the README (not tests). Run against a stack seeded with `seed-demo`:
 *   pnpm --filter @morrow/web exec playwright test -c playwright.showcase.config.ts
 */
export default defineConfig({
  testDir: './showcase',
  timeout: 15 * 60_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000', actionTimeout: 30_000 },
})
