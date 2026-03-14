/**
 * useMarkdownEditor — app-level hook with document switching support (uncontrolled)
 *
 * The editor is the single source of truth for content.
 * External updates use imperative methods (switchDocument, applyContent).
 * No value prop / value sync effect — eliminates prevValueRef circular dependency.
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

  const editor = useEditor({
    extensions: getDefaultExtensions({ onImageUpload, mentions }),
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

  // --- Document switching ---
  // Hook is stateless w.r.t. document identity — caller always provides fromId.
  const stateCacheRef = useRef(new Map<string, EditorState>());

  /**
   * Switch to a different document or update current document's content.
   *
   * @param id      Target document ID
   * @param opts.fromId   Outgoing document ID. When provided and !== id,
   *                      the current EditorState is saved under this key and
   *                      mode is reset to WYSIWYG.
   * @param opts.markdown Content to set. undefined = restore from cache.
   * @param opts.addToHistory Whether the content change is undoable (default: true).
   */
  const switchDocument = useCallback(
    (
      id: string,
      opts?: {
        fromId?: string;
        markdown?: string;
        addToHistory?: boolean;
      },
    ) => {
      if (!editor || !editor.markdown) return;
      const { fromId, markdown, addToHistory = true } = opts ?? {};

      // Save outgoing document & reset mode
      if (fromId != null && fromId !== id) {
        if (modeRef.current === "markdown") {
          // Sync raw markdown back to ProseMirror before caching
          const json = parseMarkdown(editor, rawMarkdownRef.current);
          const doc = editor.schema.nodeFromJSON(json);
          const tr = editor.state.tr.replaceWith(0, editor.state.doc.content.size, doc.content);
          tr.setMeta("skipOnChange", true);
          tr.setMeta("addToHistory", false);
          editor.view.dispatch(tr);
          setModeState("wysiwyg");
        }
        stateCacheRef.current.set(fromId, editor.state);
      }

      // Restore from cache
      if (markdown === undefined) {
        const cached = stateCacheRef.current.get(id);
        if (cached) {
          editor.view.updateState(cached);
          onCharCountRef.current?.(editor.getMarkdown().length);
        }
        return;
      }

      // New content — parse and apply
      if (!addToHistory) {
        // No undo entry: create fresh EditorState
        const json = parseMarkdown(editor, markdown);
        const doc = editor.schema.nodeFromJSON(json);
        const newState = createEditorState(editor, doc);
        editor.view.updateState(newState);
      } else {
        // With undo: replaceWith transaction
        const json = parseMarkdown(editor, markdown);
        const doc = editor.schema.nodeFromJSON(json);
        const tr = editor.state.tr.replaceWith(0, editor.state.doc.content.size, doc.content);
        tr.setMeta("addToHistory", true);
        tr.setMeta("skipOnChange", true);
        editor.view.dispatch(tr);
      }
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
    switchDocument,
    applyContent,
    getMarkdown,
    hasDocument,
    invalidateDocument,
  };
}
