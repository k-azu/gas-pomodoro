import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  // Every test gets its own browser context, and all shared state (mock server in
  // localStorage, Web Locks, BroadcastChannel) is scoped to that context. Multi-tab cases
  // open their pages from the test's own `context`, so tests can run in parallel.
  // If a test ever needs to be serialized, use `test.describe.configure({ mode: "serial" })`
  // in that file instead of lowering the global worker count.
  fullyParallel: true,
  workers: "50%",
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
