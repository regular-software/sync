import { defineConfig } from "vite";
import { searchForWorkspaceRoot } from "vite";

import viteReact from "@vitejs/plugin-react";

const config = defineConfig({
  build: {
    manifest: "asset-manifest.json",
    outDir: "dist/client",
  },
  plugins: [viteReact()],
  server: {
    fs: {
      allow: [searchForWorkspaceRoot(process.cwd())],
    },
    proxy: {
      "/api": "http://127.0.0.1:3001",
    },
  },
});

export default config;
