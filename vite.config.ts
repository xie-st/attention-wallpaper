import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@pretext-layout": fileURLToPath(new URL("./packages/pretext-layout/src/index.ts", import.meta.url)),
      "@content-model": fileURLToPath(new URL("./packages/content-model/src/index.ts", import.meta.url)),
      "@layout-region": fileURLToPath(new URL("./packages/layout-region/src/index.ts", import.meta.url)),
      "@": fileURLToPath(new URL("./src", import.meta.url))
    }
  },
  clearScreen: false,
  server: {
    host: host || false,
    port: 1420,
    strictPort: true,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**", "**/target/**"] }
  },
  build: {
    target: "esnext",
    minify: "esbuild",
    sourcemap: false
  },
  test: {
    environment: "node",
    include: ["packages/**/src/**/*.test.ts", "src/**/*.test.ts"]
  }
});
