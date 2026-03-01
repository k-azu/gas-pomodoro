/**
 * MarkdownEditorWrapper — React wrapper around tiptap-markdown-editor
 *
 * Exposes an imperative ref (MarkdownEditorRef) for getValue/setValue/switchDocument/clear.
 *
 * Supports two usage patterns:
 * 1. Without children: renders a single MarkdownEditor (toolbar + body together)
 * 2. With children: uses EditorProvider + EditorToolbar + children + EditorBody
 *    to allow inserting content between toolbar and editor body
 */
import { useState, useEffect, useRef, useCallback, type ReactNode } from "react";
import { MarkdownEditor, EditorProvider, EditorToolbar, EditorBody } from "tiptap-markdown-editor";
import type { MentionTrigger } from "tiptap-markdown-editor";

export interface MarkdownEditorRef {
  getValue: () => string;
  setValue: (markdown: string) => void;
  switchDocument: (id: string, markdown: string) => void;
  hasDocument: (id: string) => boolean;
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
  children?: ReactNode;
  toolbarLeft?: ReactNode;
  toolbarRight?: ReactNode;
}) {
  const [content, setContent] = useState(initialValue);
  const [activeDocId, setActiveDocId] = useState(documentId);
  const contentRef = useRef(initialValue);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const knownDocs = useRef(new Set<string>());

  if (documentId) knownDocs.current.add(documentId);

  const handleChange = useCallback((markdown: string) => {
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
      switchDocument: (id, md) => {
        knownDocs.current.add(id);
        setActiveDocId(id);
        contentRef.current = md;
        setContent(md);
      },
      hasDocument: (id) => knownDocs.current.has(id),
      clear: () => {
        contentRef.current = "";
        setContent("");
      },
      flushSave: () => {
        // onChange is called synchronously on each edit; no buffered save to flush
      },
    };
  });

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
          {children}
          <EditorBody placeholder={placeholder} />
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
