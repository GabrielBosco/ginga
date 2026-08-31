import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const packageJson = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version?: string };
const webVersion = String(packageJson.version || "0.0.0");

export default defineConfig({
  plugins: [react()],
  define: {
    __GINGA_WEB_VERSION__: JSON.stringify(webVersion)
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3001",
      "/uploads": "http://localhost:3001",
      "/socket.io": {
        target: "http://localhost:3001",
        ws: true
      }
    }
  }
});
