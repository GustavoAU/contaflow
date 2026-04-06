// vitest.config.ts
import { defineConfig } from "vitest/config";
import path from "path";

// Note: @vitejs/plugin-react is excluded from the Vitest config.
// The react plugin's configResolved hook accesses config.experimental.bundledDev
// which is undefined in the Vitest environment, crashing all tests.
// Component tests that need JSX use // @vitest-environment jsdom on the first line.

// Note: pool is set to 'vmForks' because the default 'forks' pool does not
// properly initialize the Vitest runner context on Windows/Node 22 (Vitest 4.x).
// 'vmForks' uses Node.js vm isolation which works correctly.
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    pool: "vmForks",
    env: {
      NODE_ENV: "test",
      DATABASE_URL: process.env.DATABASE_URL ?? "postgresql://test:test@localhost:5432/test",
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "json-summary", "html"],
      reportsDirectory: "./coverage",
      // PDF services usan @react-pdf/renderer — no testeable en Node runner
      exclude: ["**/*PDFService.ts", "**/*PDFService.tsx"],
      thresholds: {
        branches: 50,
        functions: 70,
        lines: 73,
        statements: 70,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
