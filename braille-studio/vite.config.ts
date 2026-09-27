import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // The liblouis WASM build and its pinned translation tables are served as
  // static assets from public/vendor/liblouis — everything stays local.
  publicDir: "public",
  server: { port: 5173 },
});
