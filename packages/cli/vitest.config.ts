import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Scratch machine install registry for every test file (never the real one).
    setupFiles: ["./src/test-support/vitest-setup.ts"],
  },
});
