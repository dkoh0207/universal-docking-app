import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// inotify does not work on Windows drives mounted in WSL (/mnt/c/...): poll for changes there
const polling = process.cwd().startsWith("/mnt/");
const proxy = { "/api": `http://127.0.0.1:${process.env.BACKEND_PORT || 8787}` };

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  build: { chunkSizeWarningLimit: 2500 },
  server: { port: 5179, strictPort: true, proxy, watch: polling ? { usePolling: true, interval: 300 } : undefined },
  preview: { proxy },
});
