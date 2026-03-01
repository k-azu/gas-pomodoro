import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig(({ command }) => ({
  root: "client",
  plugins: [react()],
  build: {
    outDir: path.resolve(__dirname, "dist"),
    emptyOutDir: true,
    lib: {
      entry: path.resolve(__dirname, "client/main.tsx"),
      name: "GasPomodoro",
      formats: ["iife"],
      fileName: () => "assets/index.js",
    },
    rollupOptions: {
      external: [
        "react",
        "react-dom",
        "react-dom/client",
        "react/jsx-runtime",
        "tiptap-markdown-editor",
        /^tiptap-markdown-editor\//,
      ],
      output: {
        globals: {
          react: "React",
          "react-dom": "ReactDOM",
          "react-dom/client": "ReactDOM",
          "react/jsx-runtime": "React",
          "tiptap-markdown-editor": "TiptapMarkdownEditor",
        },
        assetFileNames: "assets/[name][extname]",
      },
    },
    cssCodeSplit: false,
    minify: "esbuild",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "client"),
    },
  },
  // Dev server serves client/index.html normally (lib mode only affects build)
  server: {
    port: command === "serve" ? 5174 : undefined,
  },
}));
