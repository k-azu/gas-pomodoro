/**
 * useMarkdownEditor — app-level hook with document switching support
 *
 * Based on demo/useMarkdownEditor.ts (single-document), extended with:
 * - EditorState cache per documentId (undo history, cursor)
 * - Document switch always resets to WYSIWYG mode
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { EditorMode, EditorState, MentionTrigger } from "tiptap-markdown-editor";
import {
  useEditor,
  getDefaultExtensions,
  parseMarkdown,
  createEditorState,
} from "tiptap-markdown-editor";

interface UseMarkdownEditorOptions {
  value: string;
  onChange: (markdown: string) => void;
  documentId?: string;
  defaultMode?: EditorMode;
  readOnly?: boolean;
  onImageUpload?: (file: File) => Promise<string>;
  onFocus?: () => void;
  onBlur?: () => void;
  mentions?: MentionTrigger[];
  /** Ref controlling addToHistory for external value sync.
   * Set to false before initial-load switchDocument to prevent undo entry.
   * Automatically reset to true after consumed. */
  addToHistoryRef?: React.RefObject<boolean>;
}

export function useMarkdownEditor({
  value,
  onChange,
  documentId,
  defaultMode = "wysiwyg",
  readOnly = false,
  onImageUpload,
  onFocus,
  onBlur,
  mentions,
  addToHistoryRef,
}: UseMarkdownEditorOptions) {
  const [mode, setModeState] = useState<EditorMode>(defaultMode);
  const [rawMarkdown, setRawMarkdownState] = useState(value);
  const rawMarkdownRef = useRef(rawMarkdown);
  rawMarkdownRef.current = rawMarkdown;
  // Guards the external value sync effect against redundant dispatches.
  // Updated in onUpdate/setRawMarkdown (to track editor content during typing)
  // and in doc-switch/value-sync effects (to track value prop changes).
  // Do NOT update in setMode — doing so desynchronizes the guard from the
  // value prop on cache-hit document switches (see M7/M8 tests).
  const prevValueRef = useRef(value);

  const editor = useEditor({
    extensions: getDefaultExtensions({ onImageUpload, mentions }),
    ...(value ? { content: value, contentType: "markdown" as const } : {}),
    editable: !readOnly,
    onUpdate({ editor, transaction }) {
      if (transaction.getMeta("skipOnChange")) return;
      const markdown = editor.getMarkdown();
      prevValueRef.current = markdown;
      onChange(markdown);
    },
    onFocus() {
      onFocus?.();
    },
    onBlur() {
      onBlur?.();
    },
  });

  // --- Document switching ---
  const stateCacheRef = useRef(new Map<string, EditorState>());
  const prevDocIdRef = useRef(documentId);

  useEffect(() => {
    if (!editor || !editor.markdown) return;
    if (documentId === prevDocIdRef.current) return;

    // Save current document's EditorState
    if (prevDocIdRef.current != null) {
      if (mode === "markdown") {
        const json = parseMarkdown(editor, rawMarkdownRef.current);
        const doc = editor.schema.nodeFromJSON(json);
        const tr = editor.state.tr.replaceWith(0, editor.state.doc.content.size, doc.content);
        tr.setMeta("skipOnChange", true);
        tr.setMeta("addToHistory", false);
        editor.view.dispatch(tr);
      }
      stateCacheRef.current.set(prevDocIdRef.current, editor.state);
    }
    prevDocIdRef.current = documentId;

    // Always reset to WYSIWYG on document switch (state-only, no parse/dispatch)
    if (mode === "markdown") {
      setModeState("wysiwyg");
    }

    if (documentId != null) {
      const cached = stateCacheRef.current.get(documentId);
      if (cached) {
        editor.view.updateState(cached);
        prevValueRef.current = value;
        return;
      }
      // New document — parse into doc and create fresh EditorState
      const json = parseMarkdown(editor, value);
      const doc = editor.schema.nodeFromJSON(json);
      const newState = createEditorState(editor, doc);
      editor.view.updateState(newState);
      prevValueRef.current = value;
    }
  }, [documentId, editor, value, mode]);

  // --- External value sync (controlled component) ---
  useEffect(() => {
    if (!editor || !editor.markdown) return;
    if (value === prevValueRef.current) return;

    if (mode !== "wysiwyg") {
      setRawMarkdownState(value);
      prevValueRef.current = value;
      return;
    }

    const json = parseMarkdown(editor, value);
    const doc = editor.schema.nodeFromJSON(json);
    const tr = editor.state.tr.replaceWith(0, editor.state.doc.content.size, doc.content);
    const addToHistory = addToHistoryRef?.current ?? true;
    if (addToHistoryRef) addToHistoryRef.current = true; // reset after consume
    tr.setMeta("addToHistory", addToHistory);
    tr.setMeta("skipOnChange", true);
    editor.view.dispatch(tr);
    prevValueRef.current = value;
  }, [value, editor, mode]);

  // Sync editable state
  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!readOnly, false);
  }, [editor, readOnly]);

  const setMode = useCallback(
    (newMode: EditorMode) => {
      if (!editor) return;

      if (newMode === "markdown") {
        const markdown = editor.getMarkdown();
        setRawMarkdownState(markdown);
      } else if (newMode === "wysiwyg" && editor.markdown) {
        const current = rawMarkdownRef.current;
        const json = parseMarkdown(editor, current);
        const doc = editor.schema.nodeFromJSON(json);
        const tr = editor.state.tr.replaceWith(0, editor.state.doc.content.size, doc.content);
        tr.setMeta("addToHistory", false);
        tr.setMeta("skipOnChange", true);
        editor.view.dispatch(tr);
        onChange(current);
      }
      setModeState(newMode);
    },
    [editor, onChange],
  );

  const setRawMarkdown = useCallback(
    (markdown: string) => {
      setRawMarkdownState(markdown);
      prevValueRef.current = markdown;
      onChange(markdown);
    },
    [onChange],
  );

  /** Invalidate cached EditorState for a document (e.g. after content resolve) */
  const invalidateDocument = useCallback((id: string) => {
    stateCacheRef.current.delete(id);
  }, []);

  /** Check if a document has cached EditorState */
  const hasDocument = useCallback((id: string) => {
    return stateCacheRef.current.has(id);
  }, []);

  return {
    editor,
    mode,
    setMode,
    rawMarkdown,
    setRawMarkdown,
    hasDocument,
    invalidateDocument,
  };
}
