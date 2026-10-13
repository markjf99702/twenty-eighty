import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Several suites sim long stretches of a season in beforeAll (to the trade deadline,
    // 60 days, a whole year), which takes many CPU-seconds on a busy machine.
    testTimeout: 300_000,
    hookTimeout: 300_000,
  },
});
