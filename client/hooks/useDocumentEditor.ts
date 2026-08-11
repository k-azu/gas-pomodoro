/**
 * UI-facing composition hook for a document editor.
 *
 * Editing stays in useMarkdownEditor, persistence and synchronization stay in
 * useDocumentController, and this hook only connects them to view concerns.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MentionTrigger } from "../editor/hitomdEditor";
import { documentKey, type ContentSnapshot, type ResolveDocument } from "../lib/documentSync";
import {
  getDocumentConflict,
  getDocumentSyncStatus,
  isDocumentReadOnly,
} from "../lib/documentSessionModel";
import { useDocumentController } from "./useDocumentController";
import type { SaveDocumentContent } from "./useDocumentSaveQueue";
import { useDocumentSession } from "./useDocumentSession";
import { useDocumentViewCache } from "./useDocumentViewCache";
import { useMarkdownEditor } from "./useMarkdownEditor";

interface UseDocumentEditorOptions {
  scope: string;
  id: string;
  loadContentSnapshot: (id: string) => Promise<ContentSnapshot | null>;
  saveContent: SaveDocumentContent;
  /** Flush server sync for the given id (bypass 30s debounce) */
  flushSync?: (id: string) => void;
  resolveContent?: ResolveDocument;
  /** Transform content after loading (e.g. resolve Drive URLs to blob URLs) */
  transformOnLoad?: (content: string) => string | Promise<string>;
  /** Transform content before saving (e.g. convert blob URLs to Drive URLs) */
  transformOnSave?: (content: string) => string;
  onImageUpload?: (file: File) => Promise<string>;
  onResolveLink?: (url: string) => Promise<{ title?: string }>;
  mentions?: MentionTrigger[];
  /** Keep the document non-editable regardless of synchronization state. */
  forceReadOnly?: boolean;
  /** Whether the consumer has afterMeta content — used for scroll key differentiation */
  hasAfterMeta?: boolean;
}

export function useDocumentEditor({
  scope,
  id,
  loadContentSnapshot,
  saveContent,
  flushSync,
  resolveContent,
  transformOnLoad,
  transformOnSave,
  onImageUpload,
  onResolveLink,
  mentions,
  forceReadOnly = false,
  hasAfterMeta = false,
}: UseDocumentEditorOptions) {
  const [charCount, setCharCount] = useState(0);
  const [session, dispatchSession] = useDocumentSession();
  const viewCache = useDocumentViewCache();
  const readOnly = isDocumentReadOnly(session) || forceReadOnly;

  // The editor and controller depend on each other. A stable relay keeps the
  // editor instance independent while always forwarding to the latest controller.
  const onChangeRef = useRef<(markdown: string) => void>(() => undefined);
  const handleEditorChange = useCallback((markdown: string) => {
    onChangeRef.current(markdown);
  }, []);

  const {
    editor,
    mode,
    setMode,
    rawMarkdown,
    setRawMarkdown,
    captureState,
    restoreState,
    resetContent,
    applyContent,
  } = useMarkdownEditor({
    initialContent: "",
    onChange: handleEditorChange,
    onCharCount: setCharCount,
    readOnly,
    onImageUpload,
    onResolveLink,
    mentions,
  });

  const editorPort = useMemo(
    () => ({ captureState, restoreState, resetContent, applyContent }),
    [applyContent, captureState, resetContent, restoreState],
  );

  const controller = useDocumentController({
    scope,
    id,
    loadContentSnapshot,
    saveContent,
    flushSync,
    resolveContent,
    transformOnLoad,
    transformOnSave,
    forceReadOnly,
    editor: editorPort,
    session,
    dispatchSession,
    viewCache,
  });
  onChangeRef.current = controller.handleChange;

  const currentDocKey = documentKey(scope, id);
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevScrollDocKeyRef = useRef(currentDocKey);
  const prevHasAfterMetaRef = useRef(hasAfterMeta);

  if (
    currentDocKey !== prevScrollDocKeyRef.current ||
    hasAfterMeta !== prevHasAfterMetaRef.current
  ) {
    const container = scrollRef.current;
    const previousDocKey = prevScrollDocKeyRef.current;
    if (container && previousDocKey) {
      const key = viewCache.scrollKey(previousDocKey, prevHasAfterMetaRef.current);
      viewCache.saveScroll(key, container.scrollTop);
    }
    prevScrollDocKeyRef.current = currentDocKey;
    prevHasAfterMetaRef.current = hasAfterMeta;
  }

  const prevScrollKeyRef = useRef(viewCache.scrollKey(currentDocKey, hasAfterMeta));
  useEffect(() => {
    const key = viewCache.scrollKey(currentDocKey, hasAfterMeta);
    if (key === prevScrollKeyRef.current) return;
    prevScrollKeyRef.current = key;

    const container = scrollRef.current;
    if (!container || !id) return;

    const target = viewCache.getScroll(key) ?? 0;
    container.scrollTop = target;
    if (target === 0 || container.scrollTop === target) return;

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
  }, [currentDocKey, hasAfterMeta, id, viewCache]);

  return {
    editor,
    mode,
    setMode,
    rawMarkdown,
    setRawMarkdown,
    charCount,
    scrollRef,
    readOnly,
    syncStatus: getDocumentSyncStatus(session),
    contentVersion: controller.contentVersion,
    flushPendingSave: controller.flushPendingSave,
    conflict: getDocumentConflict(session),
    acceptRemoteContent: controller.acceptRemoteContent,
    keepLocalContent: controller.keepLocalContent,
  };
}
