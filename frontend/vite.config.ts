import { defineConfig } from "vite";

const proxy = { "/api": `http://127.0.0.1:${process.env.BACKEND_PORT || 8787}` };

export default defineConfig({
  build: { chunkSizeWarningLimit: 2500 },
  server: { port: 5179, strictPort: true, proxy },
  preview: { proxy },
});
