/**
 * md-gitlab の gas-dist/ からビルド成果物を読み込み、
 * GAS の HTML テンプレートとして src/ に出力する。
 */
const fs = require("fs");
const path = require("path");

const MD_GITLAB_DIR = process.env.MD_GITLAB_DIR
  ? path.resolve(process.env.MD_GITLAB_DIR)
  : path.resolve(__dirname, "../../md-gitlab");
const MD_GITLAB_DIST = path.join(MD_GITLAB_DIR, "gas-dist");
const SRC_DIR = path.resolve(__dirname, "../src");

const jsPath = path.join(MD_GITLAB_DIST, "md-gitlab-gas.iife.js");
const cssPath = path.join(MD_GITLAB_DIST, "style.css");

if (!fs.existsSync(jsPath)) {
  console.error("ERROR: " + jsPath + " not found. Run 'npm run editor:build' first.");
  process.exit(1);
}

// EditorBundle.html — JS wrapped in <script>
const jsContent = fs.readFileSync(jsPath, "utf-8");
fs.writeFileSync(
  path.join(SRC_DIR, "EditorBundle.html"),
  "<script>\n" + jsContent + "\n</script>\n"
);
console.log("Created src/EditorBundle.html");

// EditorStyles.html — CSS wrapped in <style>
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
