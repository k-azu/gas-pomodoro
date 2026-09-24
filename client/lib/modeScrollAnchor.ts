import type { Editor, EditorMode } from "../editor/hitomdEditor";

const TEXT_START_LENGTH = 160;
const TEXT_NEAR_LENGTH = 120;

interface BlockIdentity {
  index: number;
  text: string;
}

interface MarkdownBlock extends BlockIdentity {
  start: number;
  end: number;
}

export type ModeScrollAnchor =
  | { kind: "start" }
  | { kind: "ratio"; fallbackRatio: number }
  | {
      kind: "block";
      blockIndex: number;
      blockRatio: number;
      textStart: string;
      textNear: string;
      fallbackRatio: number;
    };

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function blockHints(
  text: string,
  ratio: number,
): {
  textStart: string;
  textNear: string;
} {
  const normalized = normalizeText(text);
  const center = Math.round(normalized.length * clamp(ratio, 0, 1));
  const half = Math.floor(TEXT_NEAR_LENGTH / 2);
  const nearStart = clamp(center - half, 0, Math.max(0, normalized.length - TEXT_NEAR_LENGTH));
  return {
    textStart: normalized.slice(0, TEXT_START_LENGTH),
    textNear: normalized.slice(nearStart, nearStart + TEXT_NEAR_LENGTH),
  };
}

function fallbackRatio(container: HTMLElement): number {
  const maxScroll = container.scrollHeight - container.clientHeight;
  return maxScroll > 0 ? container.scrollTop / maxScroll : 0;
}

function restoreRatio(container: HTMLElement, ratio: number): void {
  const maxScroll = container.scrollHeight - container.clientHeight;
  container.scrollTop = maxScroll > 0 ? clamp(ratio, 0, 1) * maxScroll : 0;
}

function anchorViewportY(container: HTMLElement): number {
  const toolbar = container.querySelector<HTMLElement>(
    ".mdg-editor-toolbar-row, .mdg-editor-header",
  );
  let bottom = toolbar?.getBoundingClientRect().bottom ?? container.getBoundingClientRect().top;

  // When document search is open, its bar and the editor toolbar form one sticky unit.
  const toolbarParent = toolbar?.parentElement;
  if (toolbarParent?.querySelector(':scope > [role="search"]')) {
    bottom = toolbarParent.getBoundingClientRect().bottom;
  }

  const containerRect = container.getBoundingClientRect();
  return clamp(bottom + 8, containerRect.top, containerRect.bottom - 1);
}

function richBlocks(editor: Editor): HTMLElement[] {
  return Array.from(editor.view.dom.children).filter(
    (child): child is HTMLElement =>
      child instanceof HTMLElement && child.getBoundingClientRect().height > 0,
  );
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function tokenPlainText(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map(tokenPlainText).filter(Boolean).join(" ");
  }

  const token = record(value);
  if (!token) return "";

  const childKeys = ["summaryTokens", "tokens", "items"];
  const childText = childKeys
    .map((key) => tokenPlainText(token[key]))
    .filter(Boolean)
    .join(" ");
  if (childText) return childText;

  const text = typeof token.text === "string" ? token.text : "";
  if (token.type === "html" && text) {
    const doc = new DOMParser().parseFromString(text, "text/html");
    return doc.body.textContent ?? "";
  }
  return text;
}

function fallbackMarkdownBlocks(markdown: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  const pattern = /\S(?:.|\n)*?(?=\n[ \t]*\n|$)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(markdown))) {
    blocks.push({
      index: blocks.length,
      start: match.index,
      end: match.index + match[0].length,
      text: match[0],
    });
  }
  return blocks;
}

function markdownBlocks(editor: Editor, markdown: string): MarkdownBlock[] {
  try {
    const tokens = editor.markdown?.instance.lexer(markdown) ?? [];
    const blocks: MarkdownBlock[] = [];
    let cursor = 0;

    for (const value of tokens as unknown[]) {
      const token = record(value);
      if (!token) continue;
      const raw = typeof token.raw === "string" ? token.raw : "";
      const start = raw ? markdown.indexOf(raw, cursor) : cursor;
      const safeStart = start >= 0 ? start : cursor;
      const end = safeStart + raw.length;
      cursor = end;

      // Whitespace tokens do not have a stable visual counterpart. An anchor in one is
      // associated with the nearest semantic token below.
      if (token.type === "space" || raw.length === 0) continue;
      blocks.push({
        index: blocks.length,
        start: safeStart,
        end,
        text: tokenPlainText(token),
      });
    }

    return blocks.length > 0 ? blocks : fallbackMarkdownBlocks(markdown);
  } catch {
    // Incomplete Markdown is valid while typing even when the lexer cannot process it.
    return fallbackMarkdownBlocks(markdown);
  }
}

function commonPrefixLength(left: string, right: string): number {
  const limit = Math.min(left.length, right.length);
  let index = 0;
  while (index < limit && left[index] === right[index]) index += 1;
  return index;
}

export function findBestScrollBlockIndex(
  candidates: BlockIdentity[],
  anchor: Extract<ModeScrollAnchor, { kind: "block" }>,
): number {
  if (candidates.length === 0) return -1;

  let bestIndex = clamp(anchor.blockIndex, 0, candidates.length - 1);
  let bestScore = Number.NEGATIVE_INFINITY;

  for (let index = 0; index < candidates.length; index += 1) {
    const text = normalizeText(candidates[index].text);
    const distancePenalty = Math.abs(index - anchor.blockIndex) * 2;
    let score = -distancePenalty;

    if (text && anchor.textStart) {
      if (text === anchor.textStart) score += 200;
      else if (text.startsWith(anchor.textStart) || anchor.textStart.startsWith(text)) score += 100;
      else score += Math.min(60, commonPrefixLength(text, anchor.textStart));
    }
    if (
      text &&
      anchor.textNear.length >= 8 &&
      (text.includes(anchor.textNear) || anchor.textNear.includes(text))
    ) {
      score += 120;
    }

    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }

  return bestIndex;
}

const MIRROR_PROPERTIES = [
  "box-sizing",
  "width",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "border-top-width",
  "border-right-width",
  "border-bottom-width",
  "border-left-width",
  "font-family",
  "font-size",
  "font-style",
  "font-variant",
  "font-weight",
  "letter-spacing",
  "line-height",
  "text-align",
  "text-indent",
  "text-transform",
  "tab-size",
  "word-break",
  "word-spacing",
] as const;

function withTextareaMirror<T>(
  textarea: HTMLTextAreaElement,
  callback: (measureOffsetTop: (offset: number) => number) => T,
): T {
  const computed = getComputedStyle(textarea);
  const mirror = document.createElement("div");
  for (const property of MIRROR_PROPERTIES) {
    mirror.style.setProperty(property, computed.getPropertyValue(property));
  }
  mirror.style.position = "fixed";
  mirror.style.top = "0";
  mirror.style.left = "-100000px";
  mirror.style.height = "auto";
  mirror.style.minHeight = "0";
  mirror.style.overflow = "visible";
  mirror.style.overflowWrap = "break-word";
  mirror.style.whiteSpace = "pre-wrap";
  mirror.style.visibility = "hidden";
  mirror.style.pointerEvents = "none";

  const marker = document.createElement("span");
  marker.textContent = "\u200b";
  document.body.appendChild(mirror);

  const measureOffsetTop = (offset: number): number => {
    mirror.replaceChildren(document.createTextNode(textarea.value.slice(0, offset)), marker);
    return marker.getBoundingClientRect().top - mirror.getBoundingClientRect().top;
  };

  try {
    return callback(measureOffsetTop);
  } finally {
    mirror.remove();
  }
}

function textareaOffsetAtY(textarea: HTMLTextAreaElement, viewportY: number): number {
  const targetTop = viewportY - textarea.getBoundingClientRect().top;
  return withTextareaMirror(textarea, (measureOffsetTop) => {
    let low = 0;
    let high = textarea.value.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (measureOffsetTop(middle) < targetTop) low = middle + 1;
      else high = middle;
    }
    return low;
  });
}

function textareaYAtOffset(textarea: HTMLTextAreaElement, offset: number): number {
  const localTop = withTextareaMirror(textarea, (measureOffsetTop) => measureOffsetTop(offset));
  return textarea.getBoundingClientRect().top + localTop;
}

function nearestMarkdownBlock(blocks: MarkdownBlock[], offset: number): MarkdownBlock | null {
  if (blocks.length === 0) return null;
  return (
    blocks.find((block) => offset >= block.start && offset <= block.end) ??
    blocks.find((block) => block.start > offset) ??
    blocks[blocks.length - 1]
  );
}

export function captureModeScrollAnchor({
  container,
  editor,
  mode,
  markdown,
}: {
  container: HTMLElement;
  editor: Editor;
  mode: EditorMode;
  markdown: string;
}): ModeScrollAnchor {
  if (container.scrollTop <= 1) return { kind: "start" };

  const ratio = fallbackRatio(container);
  const viewportY = anchorViewportY(container);

  if (mode === "wysiwyg") {
    const blocks = richBlocks(editor);
    const blockIndex = blocks.findIndex(
      (block) => block.getBoundingClientRect().bottom > viewportY,
    );
    if (blockIndex < 0) return { kind: "ratio", fallbackRatio: ratio };

    const rect = blocks[blockIndex].getBoundingClientRect();
    const blockRatio = rect.height > 0 ? clamp((viewportY - rect.top) / rect.height, 0, 1) : 0;
    return {
      kind: "block",
      blockIndex,
      blockRatio,
      ...blockHints(
        blocks[blockIndex].innerText || blocks[blockIndex].textContent || "",
        blockRatio,
      ),
      fallbackRatio: ratio,
    };
  }

  const textarea = container.querySelector<HTMLTextAreaElement>(".mdg-raw-editor");
  if (!textarea || viewportY < textarea.getBoundingClientRect().top) {
    return { kind: "ratio", fallbackRatio: ratio };
  }

  const offset = textareaOffsetAtY(textarea, viewportY);
  const blocks = markdownBlocks(editor, markdown);
  const block = nearestMarkdownBlock(blocks, offset);
  if (!block) return { kind: "ratio", fallbackRatio: ratio };

  const blockRatio =
    block.end > block.start ? clamp((offset - block.start) / (block.end - block.start), 0, 1) : 0;
  return {
    kind: "block",
    blockIndex: block.index,
    blockRatio,
    ...blockHints(block.text, blockRatio),
    fallbackRatio: ratio,
  };
}

export function restoreModeScrollAnchor({
  anchor,
  container,
  editor,
  mode,
  markdown,
}: {
  anchor: ModeScrollAnchor;
  container: HTMLElement;
  editor: Editor;
  mode: EditorMode;
  markdown: string;
}): boolean {
  if (anchor.kind === "start") {
    container.scrollTop = 0;
    return true;
  }
  if (anchor.kind === "ratio") {
    restoreRatio(container, anchor.fallbackRatio);
    return true;
  }

  const viewportY = anchorViewportY(container);
  if (mode === "wysiwyg") {
    const blocks = richBlocks(editor);
    const index = findBestScrollBlockIndex(
      blocks.map((block, blockIndex) => ({
        index: blockIndex,
        text: block.innerText || block.textContent || "",
      })),
      anchor,
    );
    const block = blocks[index];
    if (!block) {
      restoreRatio(container, anchor.fallbackRatio);
      return false;
    }

    const rect = block.getBoundingClientRect();
    const targetY = rect.top + rect.height * anchor.blockRatio;
    container.scrollTop += targetY - viewportY;
    return true;
  }

  const textarea = container.querySelector<HTMLTextAreaElement>(".mdg-raw-editor");
  if (!textarea) {
    restoreRatio(container, anchor.fallbackRatio);
    return false;
  }
  const blocks = markdownBlocks(editor, markdown);
  const index = findBestScrollBlockIndex(blocks, anchor);
  const block = blocks[index];
  if (!block) {
    restoreRatio(container, anchor.fallbackRatio);
    return false;
  }

  const targetOffset = Math.round(block.start + (block.end - block.start) * anchor.blockRatio);
  container.scrollTop += textareaYAtOffset(textarea, targetOffset) - viewportY;
  return true;
}
