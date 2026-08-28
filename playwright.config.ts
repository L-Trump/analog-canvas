import { defineConfig, devices } from "@playwright/test";

// Keep Playwright's readiness probe on loopback even when the development
// machine exports a system HTTP proxy.
process.env.NO_PROXY = [process.env.NO_PROXY, "127.0.0.1", "localhost"]
  .filter(Boolean)
  .join(",");

const e2ePort = Number(process.env.ICM_E2E_PORT ?? "4173");
const e2eBaseUrl = `http://127.0.0.1:${e2ePort}`;
const chromiumExecutablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

export default defineConfig({
  testDir: "apps/editor/e2e",
  // Each scenario owns an isolated browser context. Test-level parallelism
  // lets CI shards balance cases instead of assigning the entire suite to one
  // shard based on the three large spec files.
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: "line",
  use: {
    baseURL: e2eBaseUrl,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
    ...(chromiumExecutablePath
      ? { launchOptions: { executablePath: chromiumExecutablePath } }
      : process.env.CI
        ? {}
        : { channel: "chrome" }),
  },
  webServer: {
    command: `pnpm --filter @icm/editor exec vite --host 127.0.0.1 --port ${e2ePort}`,
    url: e2eBaseUrl,
    reuseExistingServer:
      !process.env.CI && process.env.ICM_E2E_ISOLATED !== "1",
    timeout: 30_000,
  },
});
