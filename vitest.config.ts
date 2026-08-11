/// <reference types="vitest" />
import { defineConfig } from "vitest/config";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@attention": fileURLToPath(new URL("./packages/attention/src/index.ts", import.meta.url)),
      "@pretext-layout": fileURLToPath(new URL("./packages/pretext-layout/src/index.ts", import.meta.url)),
      "@content-model": fileURLToPath(new URL("./packages/content-model/src/index.ts", import.meta.url)),
      "@layout-region": fileURLToPath(new URL("./packages/layout-region/src/index.ts", import.meta.url)),
      "@": fileURLToPath(new URL("./src", import.meta.url))
    }
  },
  test: {
    environment: "node",
    include: ["packages/**/src/**/*.test.ts", "src/**/*.test.ts", "tests/**/*.test.ts"],
    coverage: { reporter: ["text", "html"] }
  }
});
