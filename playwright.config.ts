import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  // Every test intentionally uses the same origin and document IDs. Web Locks
  // are origin-scoped even across Playwright browser contexts, so parallel
  // workers would contend with each other instead of remaining test-isolated.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || "http://localhost:5174",
    headless: true,
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
});
