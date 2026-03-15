/**
 * useMarkdownEditor — pure single-document editor hook (uncontrolled)
 *
 * The editor is the single source of truth for content.
 * External updates use imperative methods (captureState, restoreState, resetContent, applyContent).
 * No value prop / value sync effect — eliminates prevValueRef circular dependency.
 *
 * Document switching (cache management) is NOT this hook's responsibility —
 * that belongs to the consumer (e.g. useDocumentEditor).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EditorMode, EditorState, MentionTrigger } from "tiptap-markdown-editor";
import {
  useEditor,
  getDefaultExtensions,
  parseMarkdown,
  createEditorState,
} from "tiptap-markdown-editor";

interface UseMarkdownEditorOptions {
  initialContent?: string;
  onChange: (markdown: string) => void;
  onCharCount?: (count: number) => void;
  defaultMode?: EditorMode;
  readOnly?: boolean;
  onImageUpload?: (file: File) => Promise<string>;
  onFocus?: () => void;
  onBlur?: () => void;
  mentions?: MentionTrigger[];
}

export function useMarkdownEditor({
  initialContent = "",
  onChange,
  onCharCount,
  defaultMode = "wysiwyg",
  readOnly = false,
  onImageUpload,
  onFocus,
  onBlur,
  mentions,
}: UseMarkdownEditorOptions) {
  const [mode, setModeState] = useState<EditorMode>(defaultMode);
  const [rawMarkdown, setRawMarkdownState] = useState(initialContent);
  const rawMarkdownRef = useRef(rawMarkdown);
  rawMarkdownRef.current = rawMarkdown;
  const modeRef = useRef(mode);
  modeRef.current = mode;

  // Stable callback refs to avoid stale closures in useEditor
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onCharCountRef = useRef(onCharCount);
  onCharCountRef.current = onCharCount;
  const onFocusRef = useRef(onFocus);
  onFocusRef.current = onFocus;
  const onBlurRef = useRef(onBlur);
  onBlurRef.current = onBlur;

  // Memoize extensions to prevent tiptap from calling setOptions → updateState
  // on every render (which would recreate node views and reset DOM state like
  // details open/close). getDefaultExtensions creates new instances each call.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const extensions = useMemo(() => getDefaultExtensions({ onImageUpload, mentions }), []);

  const editor = useEditor({
    extensions,
    ...(initialContent ? { content: initialContent, contentType: "markdown" as const } : {}),
    editable: !readOnly,
    onUpdate({ editor, transaction }) {
      if (transaction.getMeta("skipOnChange")) return;
      const markdown = editor.getMarkdown();
      onChangeRef.current(markdown);
      onCharCountRef.current?.(markdown.length);
    },
    onFocus() {
      onFocusRef.current?.();
    },
    onBlur() {
      onBlurRef.current?.();
    },
  });

  /**
   * Capture the current EditorState, syncing markdown mode back to ProseMirror first.
   * Returns null if editor is not ready.
   * Side effect: resets mode to WYSIWYG if currently in markdown mode.
   */
  const captureState = useCallback((): EditorState | null => {
    if (!editor || !editor.markdown) return null;
    if (modeRef.current === "markdown") {
      const json = parseMarkdown(editor, rawMarkdownRef.current);
      const doc = editor.schema.nodeFromJSON(json);
      const tr = editor.state.tr.replaceWith(0, editor.state.doc.content.size, doc.content);
      tr.setMeta("skipOnChange", true);
      tr.setMeta("addToHistory", false);
      editor.view.dispatch(tr);
      setModeState("wysiwyg");
    }
    return editor.state;
  }, [editor]);

  /**
   * Restore a previously captured EditorState.
   */
  const restoreState = useCallback(
    (state: EditorState): void => {
      if (!editor) return;
      editor.view.updateState(state);
      onCharCountRef.current?.(editor.getMarkdown().length);
    },
    [editor],
  );

  /**
   * Reset content with a new markdown string (undo history is fully reset).
   * Use this for initial load / cache miss. For undoable updates, use applyContent.
   */
  const resetContent = useCallback(
    (markdown: string): void => {
      if (!editor) return;
      const json = parseMarkdown(editor, markdown);
      const doc = editor.schema.nodeFromJSON(json);
      const newState = createEditorState(editor, doc);
      editor.view.updateState(newState);
      onCharCountRef.current?.(markdown.length);
    },
    [editor],
  );

  /**
   * Apply content to the current document (e.g. after server resolve).
   * Does NOT call onChange — caller is responsible for save suppression.
   */
  const applyContent = useCallback(
    (markdown: string, opts?: { addToHistory?: boolean }) => {
      if (!editor) return;
      const addToHistory = opts?.addToHistory ?? true;

      if (modeRef.current === "markdown") {
        setRawMarkdownState(markdown);
        rawMarkdownRef.current = markdown;
      } else {
        const json = parseMarkdown(editor, markdown);
        const doc = editor.schema.nodeFromJSON(json);
        const tr = editor.state.tr.replaceWith(0, editor.state.doc.content.size, doc.content);
        tr.setMeta("addToHistory", addToHistory);
        tr.setMeta("skipOnChange", true);
        editor.view.dispatch(tr);
      }
      onCharCountRef.current?.(markdown.length);
    },
    [editor],
  );

  /** Get current markdown content from the editor */
  const getMarkdown = useCallback(() => {
    if (modeRef.current === "markdown") {
      return rawMarkdownRef.current;
    }
    return editor?.getMarkdown() ?? "";
  }, [editor]);

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
        onChangeRef.current(current);
      }
      setModeState(newMode);
    },
    [editor],
  );

  const setRawMarkdown = useCallback((markdown: string) => {
    setRawMarkdownState(markdown);
    rawMarkdownRef.current = markdown;
    onChangeRef.current(markdown);
    onCharCountRef.current?.(markdown.length);
  }, []);

  return {
    editor,
    mode,
    setMode,
    rawMarkdown,
    setRawMarkdown,
    captureState,
    restoreState,
    resetContent,
    applyContent,
    getMarkdown,
  };
}
