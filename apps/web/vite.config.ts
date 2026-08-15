import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Vite bundles the SPA into `build/` so it does not collide with the
// `dist/` output that `tsc --build` produces for type-checking.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "build"
  },
  test: {
    // Individual test files still declare `@vitest-environment jsdom` where
    // they need a DOM; this setup file only installs a working localStorage
    // polyfill (see src/test-setup.ts) for the ones that do.
    setupFiles: ["./src/test-setup.ts"]
  }
});
