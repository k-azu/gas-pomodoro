/**
 * useDocumentEditor — shared hook for loading/switching/saving editor content
 *
 * On first mount: loads content via loadContent() and sets initialContent state.
 * On id change (while mounted): calls editorRef.switchDocument() so tiptap
 * preserves undo/redo and cursor per documentId.
 */
import { useState, useEffect, useCallback, useRef } from "react";
import type { MarkdownEditorRef } from "../components/shared/MarkdownEditorWrapper";

interface UseDocumentEditorOptions {
  id: string;
  loadContent: (id: string) => Promise<string | null>;
  saveContent: (id: string, content: string) => void;
}

export function useDocumentEditor({ id, loadContent, saveContent }: UseDocumentEditorOptions) {
  const editorRef = useRef<MarkdownEditorRef | null>(null);
  const [initialContent, setInitialContent] = useState<string | null>(null);
  const prevIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!id) return; // no document selected (e.g. MemoTab with no active memo)

    const isSwitch = prevIdRef.current !== null && prevIdRef.current !== id;
    prevIdRef.current = id;

    loadContent(id).then((content) => {
      if (isSwitch && editorRef.current) {
        // Editor already mounted → switchDocument preserves tiptap state cache
        editorRef.current.switchDocument(id, content || "");
      } else {
        // First mount → set initialValue so the editor renders with content
        setInitialContent(content || "");
      }
    });
  }, [id, loadContent]);

  const onChange = useCallback(
    (markdown: string) => {
      saveContent(id, markdown);
    },
    [id, saveContent],
  );

  return { editorRef, initialContent, onChange };
}
