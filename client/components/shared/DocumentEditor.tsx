/**
 * DocumentEditor — Unified right-panel editor + layout component
 *
 * Layout: page-root > editor-full-container > mdg-editor
 * Children are rendered as the meta section between toolbar and editor body.
 *
 * Imperative ref (MarkdownEditorRef) for getValue/setValue/switchDocument/clear.
 *
 * スクロール位置の保存/復元:
 *   保存: render 中に documentId prop の変化を検出し、DOM commit 前の scrollTop を記録。
 *   復元: useEffect で activeDocId state 変化後に scrollTop を設定。
 */
import { useState, useEffect, useRef, useCallback, useMemo, type ReactNode } from "react";
import {
  Toolbar,
  EditorBody,
  DEFAULT_TOOLBAR_ITEMS,
  insertImageWithUpload,
} from "tiptap-markdown-editor";
import type { MentionTrigger, ToolbarItem } from "tiptap-markdown-editor";
import { useMarkdownEditor } from "../../hooks/useMarkdownEditor";
import { RichTextIcon, MarkdownIcon } from "./Icons";
import s from "./DocumentEditor.module.css";

export interface MarkdownEditorRef {
  getValue: () => string;
  setValue: (markdown: string) => void;
  switchDocument: (id: string, markdown?: string) => void;
  hasDocument: (id: string) => boolean;
  invalidateDocument: (id: string) => void;
  clear: () => void;
}

interface DocumentEditorProps {
  children?: ReactNode;
  /** Content rendered after meta section, replacing the editor body when present */
  afterMeta?: ReactNode;
  toolbarLeft?: ReactNode;
  toolbarRight?: ReactNode;
  initialValue?: string;
  documentId?: string;
  onChange?: (markdown: string) => void;
  placeholder?: string;
  onImageUpload?: (file: File) => Promise<string>;
  mentions?: MentionTrigger[];
  readOnly?: boolean;
  editorRef?: React.RefObject<MarkdownEditorRef | null>;
  className?: string;
  /** Show character count in toolbar; warn when content exceeds this limit */
  maxCharCount?: number;
}

export function DocumentEditor({
  children,
  afterMeta,
  toolbarLeft,
  toolbarRight,
  className,
  initialValue = "",
  documentId,
  onChange,
  placeholder = "",
  onImageUpload,
  mentions,
  readOnly = false,
  editorRef: externalRef,
  maxCharCount,
}: DocumentEditorProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const [content, setContent] = useState(initialValue);
  const [charCount, setCharCount] = useState(initialValue.length);
  const [activeDocId, setActiveDocId] = useState(documentId);
  const activeDocIdRef = useRef(documentId);
  const contentRef = useRef(initialValue);

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const scrollPositions = useRef(new Map<string, number>());

  // Scroll key: encode both document and view mode (doc vs table)
  const hasAfterMeta = !!afterMeta;
  const scrollKeyOf = (docId: string | undefined, table: boolean) =>
    table ? `${docId}:t` : (docId ?? "");

  // Save scroll position when documentId or view mode changes.
  const prevDocIdPropRef = useRef(documentId);
  const prevHasAfterMetaRef = useRef(hasAfterMeta);
  if (documentId !== prevDocIdPropRef.current || hasAfterMeta !== prevHasAfterMetaRef.current) {
    const container = scrollRef.current;
    const prevId = activeDocIdRef.current;
    if (container && prevId) {
      const key = scrollKeyOf(prevId, prevHasAfterMetaRef.current);
      scrollPositions.current.set(key, container.scrollTop);
    }
    prevDocIdPropRef.current = documentId;
    prevHasAfterMetaRef.current = hasAfterMeta;
  }

  const handleChange = useCallback((markdown: string) => {
    if (markdown === contentRef.current) return;
    contentRef.current = markdown;
    setContent(markdown);
    setCharCount(markdown.length);
    onChangeRef.current?.(markdown);
  }, []);

  // Controls addToHistory for external value sync in useMarkdownEditor.
  // switchDocument sets false (initial load → no undo), auto-reset to true after consumed.
  // setValue keeps true (resolve → undoable).
  const addToHistoryRef = useRef(true);

  const { editor, mode, setMode, rawMarkdown, setRawMarkdown, hasDocument, invalidateDocument } =
    useMarkdownEditor({
      value: content,
      onChange: handleChange,
      documentId: activeDocId,
      readOnly,
      onImageUpload,
      mentions,
      addToHistoryRef,
    });

  // Sync charCount (and contentRef) after document switch.
  // Cache-hit switchDocument(id) skips setContent — tiptap restores internally
  // via updateState but doesn't fire onUpdate.  useMarkdownEditor's effect runs
  // first (declared earlier), so editor already holds the restored content here.
  // Only update charCount + contentRef; do NOT call setContent because `content`
  // feeds `value` to useMarkdownEditor and would trigger external value sync.
  const prevSyncDocIdRef = useRef(activeDocId);
  useEffect(() => {
    if (!editor || activeDocId === prevSyncDocIdRef.current) return;
    prevSyncDocIdRef.current = activeDocId;
    const md = editor.getMarkdown();
    contentRef.current = md;
    setCharCount(md.length);
  }, [activeDocId, editor]);

  // Resolve toolbar items with image upload action
  const toolbarItems = useMemo((): ToolbarItem[] | false => {
    if (!onImageUpload) {
      return DEFAULT_TOOLBAR_ITEMS.filter(
        (item) => !(item.type === "button" && item.name === "image"),
      );
    }
    return DEFAULT_TOOLBAR_ITEMS.map((item) => {
      if (item.type === "button" && item.name === "image") {
        return {
          ...item,
          action: (
            ed: Parameters<NonNullable<Extract<ToolbarItem, { type: "button" }>["action"]>>[0],
          ) => {
            const input = document.createElement("input");
            input.type = "file";
            input.accept = "image/*";
            input.onchange = () => {
              const file = input.files?.[0];
              if (!file) return;
              insertImageWithUpload(ed, file, onImageUpload);
            };
            input.click();
          },
        };
      }
      return item;
    });
  }, [onImageUpload]);

  // Expose imperative API via ref
  useEffect(() => {
    if (!externalRef) return;
    externalRef.current = {
      getValue: () => contentRef.current,
      setValue: (md) => {
        contentRef.current = md;
        setContent(md);
        setCharCount(md.length);
      },
      switchDocument: (id, md?) => {
        activeDocIdRef.current = id;
        setActiveDocId(id);
        if (md !== undefined) {
          addToHistoryRef.current = false; // initial load → no undo entry
          contentRef.current = md;
          setContent(md);
          setCharCount(md.length);
        }
      },
      hasDocument: (id) => hasDocument(id),
      invalidateDocument: (id) => {
        scrollPositions.current.delete(id);
        scrollPositions.current.delete(`${id}:t`);
        invalidateDocument(id);
      },
      clear: () => {
        contentRef.current = "";
        setContent("");
        setCharCount(0);
      },
    };
  });

  // Restore scroll position after document or view mode switch.
  // Content may not be fully rendered yet (tiptap re-render, entity IDB load),
  // so scrollTop can get clamped to 0 by the browser. Retry until it sticks.
  const prevScrollKeyRef = useRef(scrollKeyOf(activeDocId, hasAfterMeta));
  useEffect(() => {
    const key = scrollKeyOf(activeDocId, hasAfterMeta);
    if (key === prevScrollKeyRef.current) return;
    prevScrollKeyRef.current = key;

    const container = scrollRef.current;
    if (!container || !activeDocId) return;

    const saved = scrollPositions.current.get(key);
    const target = saved ?? 0;
    container.scrollTop = target;

    if (target === 0 || container.scrollTop === target) return;

    // scrollTop was clamped — poll until content renders and scrollHeight grows
    let cancelled = false;
    const deadline = performance.now() + 500;
    const poll = () => {
      if (cancelled) return;
      container.scrollTop = target;
      if (container.scrollTop >= target - 1 || performance.now() > deadline) return;
      requestAnimationFrame(poll);
    };
    requestAnimationFrame(poll);

    return () => {
      cancelled = true;
    };
  }, [activeDocId, hasAfterMeta]);

  const hasToolbarSlots = toolbarLeft || toolbarRight;
  const charCountEl = maxCharCount ? (
    <span className={s["char-count"]} data-over={charCount > maxCharCount ? "" : undefined}>
      {charCount.toLocaleString()} / {maxCharCount.toLocaleString()}
    </span>
  ) : null;

  return (
    <div
      ref={scrollRef}
      className={`${s["page-root"]}${afterMeta ? ` ${s["hide-editor-body"]}` : ""}`}
    >
      <div className={`editor-full-container${className ? ` ${className}` : ""}`}>
        <div className="mdg-editor">
          {hasToolbarSlots ? (
            <div className="mdg-editor-toolbar-row">
              {toolbarLeft}
              {afterMeta ? (
                <div className={s["toolbar-spacer"]} />
              ) : (
                <div className="mdg-editor-header">
                  {toolbarItems !== false && editor && mode === "wysiwyg" && (
                    <Toolbar editor={editor} items={toolbarItems} />
                  )}
                  {charCountEl}
                  <button
                    type="button"
                    className={`${s["mode-switch-btn"]} mdg-mode-btn`}
                    onClick={() => setMode(mode === "wysiwyg" ? "markdown" : "wysiwyg")}
                  >
                    {mode === "wysiwyg" ? <MarkdownIcon /> : <RichTextIcon />}
                    {mode === "wysiwyg" ? "Markdown" : "Rich Text"}
                  </button>
                </div>
              )}
              {toolbarRight}
            </div>
          ) : (
            <div className={afterMeta ? "mdg-editor-toolbar-row" : "mdg-editor-header"}>
              {!afterMeta && toolbarItems !== false && editor && mode === "wysiwyg" && (
                <Toolbar editor={editor} items={toolbarItems} />
              )}
              {!afterMeta && charCountEl}
              {!afterMeta && (
                <button
                  type="button"
                  className={`${s["mode-switch-btn"]} mdg-mode-btn`}
                  onClick={() => setMode(mode === "wysiwyg" ? "markdown" : "wysiwyg")}
                >
                  {mode === "wysiwyg" ? <MarkdownIcon /> : <RichTextIcon />}
                  {mode === "wysiwyg" ? "Markdown" : "Rich Text"}
                </button>
              )}
            </div>
          )}
          <div className="mdg-content-area">
            <div className={s["meta-section"]}>{children}</div>
            {afterMeta}
            <EditorBody
              editor={editor}
              mode={mode}
              rawMarkdown={rawMarkdown}
              setRawMarkdown={setRawMarkdown}
              placeholder={placeholder}
              readOnly={readOnly}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export function ToolbarSlot({ children }: { children: ReactNode }) {
  return <div className={s["toolbar-slot"]}>{children}</div>;
}

export function MetaTitle({ children }: { children: ReactNode }) {
  return <div className={s["meta-title-row"]}>{children}</div>;
}

/** CSS Module class for the page-root container (for use without DocumentEditor) */
export const pageRootClass = s["page-root"];
