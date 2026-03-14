import fs from "fs";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

const TIPTAP_CDN_CSS = "https://tiptap-markdown-editor.pages.dev/style.css";
const TIPTAP_CDN_JS = "https://tiptap-markdown-editor.pages.dev/tiptap-markdown-editor.react.js";

/**
 * Dev-only plugin: when ../tiptap-markdown-editor is NOT available locally,
 * resolve imports to the CDN global and inject <script>/<link> into index.html.
 * When the local package exists, this plugin is skipped entirely (full HMR dev).
 * In build mode, rollupOptions.external handles externalization instead.
 */
function tiptapCdnPlugin(): Plugin | null {
  const localPath = path.resolve(__dirname, "../tiptap-markdown-editor");
  if (fs.existsSync(localPath)) return null;

  return {
    name: "tiptap-cdn",
    enforce: "pre",
    transformIndexHtml() {
      return [
        { tag: "link", attrs: { rel: "stylesheet", href: TIPTAP_CDN_CSS }, injectTo: "head" },
        {
          tag: "script",
          attrs: { defer: true, src: TIPTAP_CDN_JS },
          injectTo: "head",
        },
      ];
    },
    resolveId(id) {
      if (id === "tiptap-markdown-editor") return "\0tiptap-runtime";
      if (id.startsWith("tiptap-markdown-editor/")) return "\0tiptap-noop";
    },
    load(id) {
      if (id === "\0tiptap-runtime") {
        return [
          "const m = window.TiptapMarkdownEditor;",
          "export default m;",
          "export const useEditor = m.useEditor;",
          "export const getDefaultExtensions = m.getDefaultExtensions;",
          "export const parseMarkdown = m.parseMarkdown;",
          "export const createEditorState = m.createEditorState;",
          "export const Toolbar = m.Toolbar;",
          "export const EditorBody = m.EditorBody;",
          "export const DEFAULT_TOOLBAR_ITEMS = m.DEFAULT_TOOLBAR_ITEMS;",
          "export const insertImageWithUpload = m.insertImageWithUpload;",
        ].join("\n");
      }
      if (id === "\0tiptap-noop") return "";
    },
  };
}

export default defineConfig(({ command }) => ({
  root: "client",
  plugins: [react(), ...(command === "serve" ? [tiptapCdnPlugin()] : [])].filter(Boolean),
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
