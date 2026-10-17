import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base "./" keeps every asset URL relative, so the app works under HA's
// per-install ingress prefix (/api/hassio_ingress/<token>/) without rewriting.
export default defineConfig({
  root: "web",
  base: "./",
  plugins: [react()],
  build: { outDir: "../dist/web", emptyOutDir: true },
});
