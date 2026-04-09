// vitest.integration.config.ts
// Run with: DATABASE_URL_TEST=... npx vitest run --config vitest.integration.config.ts
// See src/__tests__/integration/README.md for details.
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    pool: "vmForks",
    include: ["src/__tests__/integration/**/*.test.ts"],
    env: {
      NODE_ENV: "test",
      DATABASE_URL_TEST: process.env.DATABASE_URL_TEST ?? "",
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
