import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

// Proxy API + stream + file routes to the running msg-center during dev.
const target = process.env.MSGCENTER_DEV_TARGET || "http://localhost:2586";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  build: { outDir: "dist", emptyOutDir: true },
  server: {
    port: 5599,
    proxy: {
      "/api": { target, changeOrigin: true },
      "/v1": { target, changeOrigin: true },
      "/file": { target, changeOrigin: true },
      "/healthz": { target, changeOrigin: true },
    },
  },
});
