import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  // Multi-tab/Web Locks cases intentionally coordinate pages in one browser.
  // A single worker also avoids Chromium startup flakiness in constrained CI.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: {
    baseURL: "http://localhost:5174",
    headless: true,
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
});
