import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { localPublishingPlugin } from "./publish-site.js";

const adminRoot = fileURLToPath(new URL(".", import.meta.url));
const projectRoot = resolve(adminRoot, "..");

export default defineConfig({
  root: adminRoot,
  base: "/admin/",
  plugins: [react(), localPublishingPlugin(projectRoot)],
  server: {
    fs: {
      allow: [projectRoot]
    }
  },
  build: {
    outDir: resolve(adminRoot, "dist"),
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(adminRoot, "index.html")
    }
  }
});
