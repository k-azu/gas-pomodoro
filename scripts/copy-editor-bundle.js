/**
 * tiptap-markdown-editor の dist-iife/ からビルド成果物を読み込み、
 * GAS の HTML テンプレートとして src/ に出力する。
 *
 * GAS の HtmlOutput.getContent() にはファイルあたり約 650KB の
 * 実質的なサイズ上限がある。バンドルがこの上限を超える場合、
 * 自動的に複数チャンクに分割して出力する。
 */
const fs = require("fs");
const path = require("path");

const EDITOR_DIR = process.env.EDITOR_DIR
  ? path.resolve(process.env.EDITOR_DIR)
  : path.resolve(__dirname, "../../tiptap-markdown-editor");
const EDITOR_DIST = path.join(EDITOR_DIR, "dist-iife");
const SRC_DIR = path.resolve(__dirname, "../src");

const jsPath = path.join(EDITOR_DIST, "tiptap-markdown-editor.iife.js");
const cssPath = path.join(EDITOR_DIST, "style.css");

if (!fs.existsSync(jsPath)) {
  console.error("ERROR: " + jsPath + " not found. Run 'npm run editor:build' first.");
  process.exit(1);
}

// --- EditorBundle ---
const jsContent = fs.readFileSync(jsPath, "utf-8");
// <script> tag overhead (~20 bytes) + content must stay under the GAS limit.
// 500KB is a safe threshold well below the observed ~650KB limit.
const CHUNK_LIMIT = 500 * 1024;
const singleFileSize = Buffer.byteLength("<script>\n" + jsContent + "\n</script>\n", "utf-8");

// Remove any stale chunk files from previous runs
for (const f of fs.readdirSync(SRC_DIR)) {
  if (/^EditorBundle\d*\.html$/.test(f)) {
    fs.unlinkSync(path.join(SRC_DIR, f));
  }
}

if (singleFileSize <= CHUNK_LIMIT) {
  // Small enough — single file (same as before)
  fs.writeFileSync(
    path.join(SRC_DIR, "EditorBundle.html"),
    "<script>\n" + jsContent + "\n</script>\n"
  );
  console.log("Created src/EditorBundle.html (" + Math.round(singleFileSize / 1024) + "KB, single file)");
} else {
  // Too large — split into string chunks + loader
  // JSON.stringify escapes all special chars; also escape </ to prevent
  // the HTML parser from seeing </script> inside the string literal.
  const escaped = JSON.stringify(jsContent).replace(/<\//g, "<\\/");
  // escaped is: "\"...code...\""  (with surrounding double quotes)
  // Strip the surrounding quotes — each chunk gets its own quotes.
  const inner = escaped.slice(1, -1);

  // Determine chunk count so each chunk file stays under CHUNK_LIMIT.
  // Each chunk file has ~80 bytes of wrapper code + 2 bytes for quotes.
  const wrapperOverhead = 100;
  const maxPayload = CHUNK_LIMIT - wrapperOverhead;
  const numChunks = Math.ceil(Buffer.byteLength(inner, "utf-8") / maxPayload);

  // Find a safe split point that doesn't break an escape sequence.
  // A split is unsafe if it falls right after an odd number of backslashes
  // (e.g. splitting "\\\"" between \\ and \" is fine, but between \\\ and " is not).
  function safeSplitPoint(str, pos) {
    while (pos > 0 && pos < str.length) {
      let backslashes = 0;
      let j = pos - 1;
      while (j >= 0 && str[j] === "\\") { backslashes++; j--; }
      if (backslashes % 2 === 0) break; // even backslashes = safe
      pos++; // odd backslashes = mid-escape, advance one char
    }
    return pos;
  }

  // Split the inner string content into chunks.
  const charsPerChunk = Math.ceil(inner.length / numChunks);
  const chunks = [];
  let offset = 0;
  for (let c = 0; c < numChunks; c++) {
    let end;
    if (c === numChunks - 1) {
      end = inner.length;
    } else {
      end = safeSplitPoint(inner, offset + charsPerChunk);
    }
    chunks.push(inner.slice(offset, end));
    offset = end;
  }

  for (let i = 0; i < chunks.length; i++) {
    const fileName = "EditorBundle" + (i + 1) + ".html";
    const quoted = '"' + chunks[i] + '"';
    let html;
    if (i === 0) {
      // First chunk: start the accumulator
      html = "<script>window.__ebc=" + quoted + ";</script>\n";
    } else if (i < chunks.length - 1) {
      // Middle chunks: append to accumulator
      html = "<script>window.__ebc+=" + quoted + ";</script>\n";
    } else {
      // Last chunk: append, eval, clean up
      html =
        "<script>window.__ebc+=" + quoted + ";" +
        "(0,eval)(window.__ebc);" +
        "delete window.__ebc;</script>\n";
    }
    fs.writeFileSync(path.join(SRC_DIR, fileName), html);
    const kb = Math.round(Buffer.byteLength(html, "utf-8") / 1024);
    console.log("Created src/" + fileName + " (" + kb + "KB, chunk " + (i + 1) + "/" + chunks.length + ")");
  }
}

// --- EditorStyles.html ---
if (fs.existsSync(cssPath)) {
  const cssContent = fs.readFileSync(cssPath, "utf-8");
  fs.writeFileSync(
    path.join(SRC_DIR, "EditorStyles.html"),
    "<style>\n" + cssContent + "\n</style>\n"
  );
  console.log("Created src/EditorStyles.html");
} else {
  // CSS may be inlined in the JS bundle
  fs.writeFileSync(
    path.join(SRC_DIR, "EditorStyles.html"),
    "<!-- No external CSS - styles inlined in bundle -->\n"
  );
  console.log("Created src/EditorStyles.html (no external CSS)");
}
