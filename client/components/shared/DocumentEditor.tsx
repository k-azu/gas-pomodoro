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
  ModeToggle,
  EditorBody,
  DEFAULT_TOOLBAR_ITEMS,
  insertImageWithUpload,
} from "tiptap-markdown-editor";
import type { MentionTrigger, ToolbarItem } from "tiptap-markdown-editor";
import { useMarkdownEditor } from "../../hooks/useMarkdownEditor";
import s from "./DocumentEditor.module.css";

export interface MarkdownEditorRef {
  getValue: () => string;
  setValue: (markdown: string) => void;
  switchDocument: (id: string, markdown?: string) => void;
  hasDocument: (id: string) => boolean;
  invalidateDocument: (id: string) => void;
  clear: () => void;
  flushSave: () => void;
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
}: DocumentEditorProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const [content, setContent] = useState(initialValue);
  const [activeDocId, setActiveDocId] = useState(documentId);
  const activeDocIdRef = useRef(documentId);
  const contentRef = useRef(initialValue);

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const scrollPositions = useRef(new Map<string, number>());

  // Save scroll position when documentId prop signals an upcoming switch.
  const prevDocIdPropRef = useRef(documentId);
  if (documentId !== prevDocIdPropRef.current) {
    const container = scrollRef.current;
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

  const { editor, mode, setMode, rawMarkdown, setRawMarkdown, hasDocument, invalidateDocument } =
    useMarkdownEditor({
      value: content,
      onChange: handleChange,
      documentId: activeDocId,
      readOnly,
      onImageUpload,
      mentions,
    });

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
      },
      switchDocument: (id, md?) => {
        activeDocIdRef.current = id;
        setActiveDocId(id);
        if (md !== undefined) {
          contentRef.current = md;
          setContent(md);
        }
      },
      hasDocument: (id) => hasDocument(id),
      invalidateDocument: (id) => {
        scrollPositions.current.delete(id);
        invalidateDocument(id);
      },
      clear: () => {
        contentRef.current = "";
        setContent("");
      },
      flushSave: () => {},
    };
  });

  // Restore scroll position after document switch.
  const prevDocIdForScroll = useRef(activeDocId);
  useEffect(() => {
    if (activeDocId === prevDocIdForScroll.current) return;
    prevDocIdForScroll.current = activeDocId;

    const container = scrollRef.current;
    if (!container || !activeDocId) return;

    const saved = scrollPositions.current.get(activeDocId);
    container.scrollTop = saved ?? 0;
  }, [activeDocId]);

  const hasToolbarSlots = toolbarLeft || toolbarRight;

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
              <div className="mdg-editor-header">
                {toolbarItems !== false && editor && mode === "wysiwyg" && (
                  <Toolbar editor={editor} items={toolbarItems} />
                )}
                <ModeToggle mode={mode} setMode={setMode} />
              </div>
              {toolbarRight}
            </div>
          ) : (
            <div className="mdg-editor-header">
              {toolbarItems !== false && editor && mode === "wysiwyg" && (
                <Toolbar editor={editor} items={toolbarItems} />
              )}
              <ModeToggle mode={mode} setMode={setMode} />
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
