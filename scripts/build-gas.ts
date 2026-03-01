/**
 * build-gas.ts — Post-build script that produces GAS-compatible HTML files.
 *
 * 1. Bundles react + react-dom into src/ReactVendor.html (IIFE, globals React/ReactDOM)
 * 2. Wraps the Vite output (JS + CSS) into src/ClientBundle.html
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

  const js = escapeForScript(result.outputFiles[0].text);
  const html = `<script>\n${js}</script>\n`;
  const outPath = path.join(srcDir, "ReactVendor.html");
  fs.writeFileSync(outPath, html, "utf-8");
  console.log(`✓ ReactVendor.html written (${(html.length / 1024).toFixed(1)} KB)`);
}

async function buildClientBundle() {
  const jsFile = findFile(".js");
  const cssFile = findFile(".css");

  if (!jsFile) {
    console.error("No JS bundle found in dist/assets/");
    process.exit(1);
  }

  // Downlevel template literals to string concatenation for GAS compatibility.
  // GAS's Caja sanitizer doesn't handle template literals with literal newlines.
  const rawJs = fs.readFileSync(jsFile, "utf-8");
  const transformed = await esbuild.transform(rawJs, {
    loader: "js",
    target: "es2020",
    supported: { "template-literal": false },
  });
  const jsContent = escapeForScript(transformed.code);
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
  await buildClientBundle();
}

main();
