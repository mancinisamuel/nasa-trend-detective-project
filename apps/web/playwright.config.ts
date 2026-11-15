import { defineConfig, devices } from "@playwright/test";

// pnpm test:e2e starts both services in demo mode (brief §05, §12).
// Commands run from apps/web; the API script lives in the repository root.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: true,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "pnpm --dir ../.. run dev:api",
      url: "http://127.0.0.1:8000/api/v1/health",
      env: { TD_DATA_MODE: "demo" },
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: "pnpm run dev",
      url: "http://localhost:5173",
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
