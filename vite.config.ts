import fs from "fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

const localEditorCoreDir = path.resolve(__dirname, "../markweave/packages/editor-core");
const localEditorCoreSrc = path.join(localEditorCoreDir, "src/index.ts");
const useLocalEditorCore = fs.existsSync(localEditorCoreSrc);

export default defineConfig(({ command }) => {
  const useDevEditorCoreAlias = command === "serve" && useLocalEditorCore;

  return {
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
          "@markweave/editor-core",
        ],
        output: {
          globals: {
            react: "React",
            "react-dom": "ReactDOM",
            "react-dom/client": "ReactDOM",
            "react/jsx-runtime": "React",
            "@markweave/editor-core": "MarkweaveEditorCore",
          },
          assetFileNames: "assets/[name][extname]",
        },
      },
      cssCodeSplit: false,
      minify: "esbuild",
    },
    resolve: {
      alias: {
        ...(useDevEditorCoreAlias
          ? {
              "@markweave/editor-core/styles.css": path.join(localEditorCoreDir, "src/styles.css"),
              "@markweave/editor-core": localEditorCoreSrc,
            }
          : {}),
        "@": path.resolve(__dirname, "client"),
      },
      dedupe: ["react", "react-dom"],
    },
    // Dev server serves client/index.html normally (lib mode only affects build)
    server: {
      port: command === "serve" ? 5174 : undefined,
      fs: {
        allow: [path.resolve(__dirname), localEditorCoreDir],
      },
    },
  };
});
