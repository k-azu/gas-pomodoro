/**
 * build-gas.ts — Post-build script that produces GAS-compatible HTML files.
 *
 * 1. Bundles react + react-dom into src/ReactVendor.html (IIFE, globals React/ReactDOM)
 * 2. Bundles @markweave/editor-core into src/EditorVendor.html (IIFE, global MarkweaveEditorCore)
 * 3. Wraps the Vite output (JS + CSS) into src/ClientBundle.html
 *
 * Usage: npx tsx scripts/build-gas.ts  (called by `npm run build:gas`)
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import esbuild from "esbuild";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const distDir = path.resolve(root, "dist", "assets");
const srcDir = path.resolve(root, "src");

/** Escape sequences that break when inlined in <script> tags */
function escapeForScript(js: string): string {
  return js.replace(/<\/script/gi, "<\\/script");
}

async function transformForGas(js: string): Promise<string> {
  // Downlevel template literals to string concatenation for GAS compatibility.
  // GAS's Caja sanitizer doesn't handle template literals with literal newlines.
  const transformed = await esbuild.transform(js, {
    loader: "js",
    target: "es2020",
    supported: { "template-literal": false },
  });
  return escapeForScript(transformed.code);
}

function findFile(ext: string): string | null {
  if (!fs.existsSync(distDir)) return null;
  const files = fs.readdirSync(distDir);
  const match = files.find((f) => f.endsWith(ext));
  return match ? path.join(distDir, match) : null;
}

async function buildReactVendor() {
  const result = await esbuild.build({
    stdin: {
      contents: `
        import * as React from "react";
        import * as ReactDOM from "react-dom";
        import * as ReactDOMClient from "react-dom/client";
        import * as jsxRuntime from "react/jsx-runtime";
        window.React = Object.assign({}, React, jsxRuntime);
        window.ReactDOM = Object.assign({}, ReactDOM, ReactDOMClient);
      `,
      resolveDir: root,
      loader: "js",
    },
    bundle: true,
    format: "iife",
    minify: true,
    write: false,
    target: "es2020",
  });

  const js = await transformForGas(result.outputFiles[0].text);
  const html = `<script>\n${js}</script>\n`;
  const outPath = path.join(srcDir, "ReactVendor.html");
  fs.writeFileSync(outPath, html, "utf-8");
  console.log(`✓ ReactVendor.html written (${(html.length / 1024).toFixed(1)} KB)`);
}

const reactShim = `
  const React = window.React;
  export default React;
  export const Children = React.Children;
  export const Component = React.Component;
  export const Fragment = React.Fragment;
  export const Profiler = React.Profiler;
  export const PureComponent = React.PureComponent;
  export const StrictMode = React.StrictMode;
  export const Suspense = React.Suspense;
  export const cloneElement = React.cloneElement;
  export const createContext = React.createContext;
  export const createElement = React.createElement;
  export const createRef = React.createRef;
  export const forwardRef = React.forwardRef;
  export const isValidElement = React.isValidElement;
  export const lazy = React.lazy;
  export const memo = React.memo;
  export const startTransition = React.startTransition;
  export const use = React.use;
  export const useActionState = React.useActionState;
  export const useCallback = React.useCallback;
  export const useContext = React.useContext;
  export const useDebugValue = React.useDebugValue;
  export const useDeferredValue = React.useDeferredValue;
  export const useEffect = React.useEffect;
  export const useId = React.useId;
  export const useImperativeHandle = React.useImperativeHandle;
  export const useInsertionEffect = React.useInsertionEffect;
  export const useLayoutEffect = React.useLayoutEffect;
  export const useMemo = React.useMemo;
  export const useOptimistic = React.useOptimistic;
  export const useReducer = React.useReducer;
  export const useRef = React.useRef;
  export const useState = React.useState;
  export const useSyncExternalStore = React.useSyncExternalStore;
  export const useTransition = React.useTransition;
  export const version = React.version;
`;

const reactDomShim = `
  const ReactDOM = window.ReactDOM;
  export default ReactDOM;
  export const createPortal = ReactDOM.createPortal;
  export const flushSync = ReactDOM.flushSync;
  export const preconnect = ReactDOM.preconnect;
  export const prefetchDNS = ReactDOM.prefetchDNS;
  export const preinit = ReactDOM.preinit;
  export const preinitModule = ReactDOM.preinitModule;
  export const preload = ReactDOM.preload;
  export const preloadModule = ReactDOM.preloadModule;
  export const requestFormReset = ReactDOM.requestFormReset;
  export const unstable_batchedUpdates = ReactDOM.unstable_batchedUpdates;
  export const useFormStatus = ReactDOM.useFormStatus;
  export const version = ReactDOM.version;
`;

const reactDomClientShim = `
  const ReactDOM = window.ReactDOM;
  export const createRoot = ReactDOM.createRoot;
  export const hydrateRoot = ReactDOM.hydrateRoot;
`;

const jsxRuntimeShim = `
  const React = window.React;
  export const Fragment = React.Fragment;
  export const jsx = React.jsx;
  export const jsxs = React.jsxs;
  export const jsxDEV = React.jsxDEV;
`;

const mermaidShim = `
  function getMermaid() {
    const mermaid = window.mermaid;
    if (!mermaid) {
      throw new Error("Mermaid global is not loaded");
    }
    return mermaid;
  }
  export default {
    initialize: (...args) => getMermaid().initialize(...args),
    render: (...args) => getMermaid().render(...args),
  };
`;

function editorVendorPlugin(): esbuild.Plugin {
  return {
    name: "editor-vendor-globals",
    setup(build) {
      const modules = new Map([
        ["react", reactShim],
        ["react-dom", reactDomShim],
        ["react-dom/client", reactDomClientShim],
        ["react/jsx-runtime", jsxRuntimeShim],
        ["react/jsx-dev-runtime", jsxRuntimeShim],
        ["mermaid", mermaidShim],
      ]);

      build.onResolve(
        {
          filter:
            /^(react|react-dom|react-dom\/client|react\/jsx-runtime|react\/jsx-dev-runtime|mermaid)$/,
        },
        (args) => ({
          path: args.path,
          namespace: "editor-vendor-global",
        }),
      );

      build.onLoad({ filter: /.*/, namespace: "editor-vendor-global" }, (args) => ({
        contents: modules.get(args.path),
        loader: "js",
      }));
    },
  };
}

async function buildEditorVendor() {
  const result = await esbuild.build({
    stdin: {
      contents: `
        import * as MarkweaveEditorCore from "@markweave/editor-core";
        window.MarkweaveEditorCore = MarkweaveEditorCore;
      `,
      resolveDir: root,
      loader: "js",
    },
    bundle: true,
    format: "iife",
    minify: true,
    write: false,
    target: "es2020",
    plugins: [editorVendorPlugin()],
  });

  const js = await transformForGas(result.outputFiles[0].text);
  const html = `<script>\n${js}</script>\n`;
  const outPath = path.join(srcDir, "EditorVendor.html");
  fs.writeFileSync(outPath, html, "utf-8");
  console.log(`✓ EditorVendor.html written (${(html.length / 1024).toFixed(1)} KB)`);
}

async function buildClientBundle() {
  const jsFile = findFile(".js");
  const cssFile = findFile(".css");

  if (!jsFile) {
    console.error("No JS bundle found in dist/assets/");
    process.exit(1);
  }

  const rawJs = fs.readFileSync(jsFile, "utf-8");
  const jsContent = await transformForGas(rawJs);
  const cssContent = cssFile ? fs.readFileSync(cssFile, "utf-8") : "";

  let html = "";
  if (cssContent) {
    html += `<style>\n${cssContent}\n</style>\n`;
  }
  html += `<div id="root"></div>\n`;
  html += `<script>\n${jsContent}\n</script>\n`;

  const outPath = path.join(srcDir, "ClientBundle.html");
  fs.writeFileSync(outPath, html, "utf-8");
  console.log(`✓ ClientBundle.html written (${(html.length / 1024).toFixed(1)} KB)`);
}

async function main() {
  await buildReactVendor();
  await buildEditorVendor();
  await buildClientBundle();
}

main();
