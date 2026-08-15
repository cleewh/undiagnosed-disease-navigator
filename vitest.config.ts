import { defineConfig } from "vitest/config";

// Test category conventions (Requirement 31.1, 31.2):
//   *.property.test.ts    -> property-based tests (fast-check)
//   *.integration.test.ts -> API/integration tests
//   *.e2e.test.ts         -> end-to-end user-interface tests
//   *.test.ts             -> unit tests (default)
export default defineConfig({
  // Web component tests are authored in TSX; esbuild uses the automatic JSX
  // runtime so components need not import React explicitly.
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "react"
  },
  test: {
    globals: true,
    // Default environment is node; web component tests opt into jsdom via a
    // per-file `// @vitest-environment jsdom` comment.
    environment: "node",
    include: [
      "apps/**/*.test.ts",
      "apps/**/*.test.tsx",
      "packages/**/*.test.ts",
      "services/**/*.test.ts",
      "infrastructure/**/*.test.ts",
      "evaluation/**/*.test.ts",
      "tests/**/*.test.ts",
      "data/**/*.test.ts"
    ],
    exclude: ["**/node_modules/**", "**/dist/**", "**/cdk.out/**", "**/build/**"],
    reporters: ["default"]
  }
});
