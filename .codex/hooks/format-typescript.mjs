import { spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const input = await readStdin();
const patch = input?.tool_input?.command;

if (input?.hook_event_name !== "PostToolUse" || input?.tool_name !== "apply_patch") {
  process.exit(0);
}

if (typeof patch !== "string") {
  process.exit(0);
}

const repositoryRoot = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), "../.."));
const workingDirectory =
  typeof input.cwd === "string" && isAbsolute(input.cwd) ? input.cwd : repositoryRoot;
const files = collectTypeScriptFiles(patch, workingDirectory, repositoryRoot);

if (files.length === 0) {
  process.exit(0);
}

const result = spawnSync("pnpm", ["exec", "prettier", "--write", ...files], {
  cwd: repositoryRoot,
  stdio: ["ignore", "ignore", "inherit"],
});

if (result.error) {
  console.error(`Failed to run Prettier: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);

async function readStdin() {
  let data = "";

  for await (const chunk of process.stdin) {
    data += chunk;
  }

  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

function collectTypeScriptFiles(patchText, cwd, root) {
  const paths = new Set();
  const fileHeader = /^\*\*\* (?:Add File|Update File|Move to): (.+)$/gm;

  for (const match of patchText.matchAll(fileHeader)) {
    const filePath = resolve(cwd, match[1].trimEnd());

    if (![".ts", ".tsx"].includes(extname(filePath)) || !existsSync(filePath)) {
      continue;
    }

    const realFilePath = realpathSync(filePath);
    const relativePath = relative(root, realFilePath);

    if (
      relativePath === ".." ||
      relativePath.startsWith(`..${sep}`) ||
      isAbsolute(relativePath) ||
      ![".ts", ".tsx"].includes(extname(realFilePath))
    ) {
      continue;
    }

    paths.add(relativePath);
  }

  return [...paths];
}
