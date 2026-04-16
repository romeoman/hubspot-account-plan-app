import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  build: {
    emptyOutDir: true,
    lib: {
      entry: resolve(__dirname, "src/hubspot-card-entry.tsx"),
      formats: ["es"],
    },
    rollupOptions: {
      output: {
        entryFileNames: "index.js",
      },
    },
  },
});
