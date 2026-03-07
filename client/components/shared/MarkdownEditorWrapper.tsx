/**
 * MarkdownEditorWrapper — React wrapper around tiptap-markdown-editor
 *
 * Exposes an imperative ref (MarkdownEditorRef) for getValue/setValue/switchDocument/clear.
 *
 * Supports two usage patterns:
 * 1. Without children: renders a single MarkdownEditor (toolbar + body together)
 * 2. With children: uses EditorProvider + EditorToolbar + children + EditorBody
 *    to allow inserting content between toolbar and editor body
 *
 * スクロール位置の保存/復元:
 *   保存: render 中に documentId prop の変化を検出し、DOM commit 前の scrollTop を記録。
 *   復元: useEffect で activeDocId state 変化後に scrollTop を設定。
 *         tiptap EditorContent の DOM 再アタッチが paint 後のため useEffect で正しく動作する。
 */
import { useState, useEffect, useRef, useCallback, type ReactNode } from "react";
import { MarkdownEditor, EditorProvider, EditorToolbar, EditorBody } from "tiptap-markdown-editor";
import type { MentionTrigger } from "tiptap-markdown-editor";

export interface MarkdownEditorRef {
  getValue: () => string;
  setValue: (markdown: string) => void;
  switchDocument: (id: string, markdown?: string) => void;
  hasDocument: (id: string) => boolean;
  invalidateDocument: (id: string) => void;
  clear: () => void;
  flushSave: () => void;
}

export function MarkdownEditorWrapper({
  initialValue = "",
  documentId,
  onChange,
  placeholder = "",
  onImageUpload,
  mentions,
  readOnly = false,
  editorRef: externalRef,
  scrollContainerRef,
  children,
  toolbarLeft,
  toolbarRight,
}: {
  initialValue?: string;
  documentId?: string;
  onChange?: (markdown: string) => void;
  placeholder?: string;
  onImageUpload?: (file: File) => Promise<string>;
  mentions?: MentionTrigger[];
  readOnly?: boolean;
  editorRef?: React.RefObject<MarkdownEditorRef | null>;
  scrollContainerRef?: React.RefObject<HTMLElement | null>;
  children?: ReactNode;
  toolbarLeft?: ReactNode;
  toolbarRight?: ReactNode;
}) {
  const [content, setContent] = useState(initialValue);
  const [activeDocId, setActiveDocId] = useState(documentId);
  const activeDocIdRef = useRef(documentId);
  const contentRef = useRef(initialValue);

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const knownDocs = useRef(new Set<string>());
  const scrollPositions = useRef(new Map<string, number>());

  // knownDocs is only populated via switchDocument() — NOT eagerly during render.
  // This ensures hasDocument() returns true only for documents that have actually
  // been opened through switchDocument, where an EditorState cache exists.

  // Save scroll position when documentId prop signals an upcoming switch.
  // This runs during render (before DOM commit), so scrollTop still reflects
  // the pre-transition layout — the most accurate timing possible.
  const prevDocIdPropRef = useRef(documentId);
  if (documentId !== prevDocIdPropRef.current) {
    const container = scrollContainerRef?.current;
    const prevId = activeDocIdRef.current;
    if (container && prevId) {
      scrollPositions.current.set(prevId, container.scrollTop);
    }
    prevDocIdPropRef.current = documentId;
  }

  const handleChange = useCallback((markdown: string) => {
    if (markdown === contentRef.current) return;
    contentRef.current = markdown;
    setContent(markdown);
    onChangeRef.current?.(markdown);
  }, []);

  // Expose imperative API via ref
  useEffect(() => {
    if (!externalRef) return;
    externalRef.current = {
      getValue: () => contentRef.current,
      setValue: (md) => {
        contentRef.current = md;
        setContent(md);
      },
      switchDocument: (id, md?) => {
        // Register previous doc — library cached its EditorState during switch
        const prevId = activeDocIdRef.current;
        if (prevId) knownDocs.current.add(prevId);
        knownDocs.current.add(id);
        activeDocIdRef.current = id;
        setActiveDocId(id);
        if (md !== undefined) {
          contentRef.current = md;
          setContent(md);
        }
        // md === undefined → setContent しない → value prop 不変
        // → ライブラリ側: value === prevValueRef → キャッシュのみ復元
      },
      hasDocument: (id) => knownDocs.current.has(id),
      invalidateDocument: (id) => {
        knownDocs.current.delete(id);
        scrollPositions.current.delete(id);
      },
      clear: () => {
        contentRef.current = "";
        setContent("");
      },
      flushSave: () => {
        // onChange is called synchronously on each edit; no buffered save to flush
      },
    };
  });

  // Restore scroll position after document switch.
  // useEffect runs after paint — by this time tiptap's EditorContent has
  // re-attached the editor DOM and the scroll container's scrollHeight is correct.
  const prevDocIdForScroll = useRef(activeDocId);
  useEffect(() => {
    if (activeDocId === prevDocIdForScroll.current) return;
    prevDocIdForScroll.current = activeDocId;

    const container = scrollContainerRef?.current;
    if (!container || !activeDocId) return;

    const saved = scrollPositions.current.get(activeDocId);
    container.scrollTop = saved ?? 0;
  }, [activeDocId, scrollContainerRef]);

  // Split mode: toolbar, children slot, then editor body
  if (children) {
    const hasToolbarSlots = toolbarLeft || toolbarRight;
    return (
      <EditorProvider
        value={content}
        onChange={handleChange}
        documentId={activeDocId}
        placeholder={placeholder}
        readOnly={readOnly}
        onImageUpload={onImageUpload}
        mentions={mentions}
      >
        <div className="mdg-editor">
          {hasToolbarSlots ? (
            <div className="mdg-editor-toolbar-row">
              {toolbarLeft}
              <EditorToolbar />
              {toolbarRight}
            </div>
          ) : (
            <EditorToolbar />
          )}
          <div className="mdg-content-area">
            {children}
            <EditorBody />
          </div>
        </div>
      </EditorProvider>
    );
  }

  // Default: single MarkdownEditor component
  return (
    <MarkdownEditor
      value={content}
      onChange={handleChange}
      documentId={activeDocId}
      placeholder={placeholder}
      readOnly={readOnly}
      onImageUpload={onImageUpload}
      mentions={mentions}
    />
  );
}
