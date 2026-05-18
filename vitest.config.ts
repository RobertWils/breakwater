import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    globals: false,
    coverage: {
      // I.1 FIX 6 (Codex NICE_TO_HAVE): spec §14 requires ≥85% detector
      // coverage. The threshold is scoped to the governance detector
      // subtree so the gate is meaningful — application-wide thresholds
      // would dilute the signal with route / UI / scaffolding files.
      provider: "v8",
      include: ["src/lib/detectors/governance/**"],
      // Exclude __tests__ directories — measuring tests against themselves
      // is noise.
      exclude: ["**/__tests__/**", "**/*.test.ts"],
      thresholds: {
        statements: 85,
        branches: 85,
        functions: 85,
        lines: 85,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
