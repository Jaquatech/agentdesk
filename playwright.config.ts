import { defineConfig } from "@playwright/test";

const port = 4390;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://localhost:${port}`, trace: "retain-on-failure",
    // Optional: a browser you already have, when `npx playwright install` is not possible.
    launchOptions: process.env.E2E_BROWSER ? { executablePath: process.env.E2E_BROWSER } : {},
  },
  // A fresh demo database every run: the seed is what the tests look at.
  webServer: {
    command: "npm run demo:reset && npm run demo",
    env: { PORT: String(port) },
    url: `http://localhost:${port}/api/auth/status`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
