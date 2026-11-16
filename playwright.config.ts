import { defineConfig, devices } from "@playwright/test";

// Serves the production build under a subpath (/covison/) to prove the
// relative-path build works on GitHub Pages-style hosting.
export default defineConfig({
  testDir: "tests",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:4174/covison/",
    ...devices["iPhone 14 Pro Max"],
    browserName: "chromium",
    serviceWorkers: "allow",
  },
  webServer: {
    command: "npx vite preview --port 4174 --strictPort --base /covison/",
    url: "http://localhost:4174/covison/",
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
