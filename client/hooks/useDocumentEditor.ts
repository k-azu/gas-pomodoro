/**
 * useDocumentEditor — composed hook for document-switching editors
 *
 * Combines: useMarkdownEditor + document cache + load/save/resolve + scroll management.
 * Returns everything needed by EditorLayout — no refs, no indirection.
 *
 * Consumers get {editor, mode, setMode, rawMarkdown, setRawMarkdown, charCount,
 * scrollRef, readOnly, syncStatus, flushPendingSave} — no refs, no indirection.
 */
import { useState, useEffect, useCallback, useRef } from "react";
import type { EditorState, MentionTrigger } from "tiptap-markdown-editor";
import { useMarkdownEditor } from "./useMarkdownEditor";
import type { SyncStatus } from "../components/shared/SyncIndicator";
import * as EntityStore from "../lib/entityStore";

interface UseDocumentEditorOptions {
  id: string;
  loadContent: (id: string) => Promise<string | null>;
  saveContent: (id: string, content: string, opts?: { immediateSync?: boolean }) => Promise<void>;
  /** Flush server sync for the given id (bypass 30s debounce) */
  flushSync?: (id: string) => void;
  resolveContent?: (id: string) => Promise<{ useServer: boolean; content?: string } | null>;
  /** Transform content after loading (e.g. resolve Drive URLs to blob URLs) */
  transformOnLoad?: (content: string) => string | Promise<string>;
  /** Transform content before saving (e.g. convert blob URLs to Drive URLs) */
  transformOnSave?: (content: string) => string;
  onImageUpload?: (file: File) => Promise<string>;
  onResolveLink?: (url: string) => Promise<{ title?: string }>;
  mentions?: MentionTrigger[];
  /** Whether the consumer has afterMeta content — used for scroll key differentiation */
  hasAfterMeta?: boolean;
}

// Track resolve status per document in this session
const _resolveStatus = new Map<string, "resolving" | "synced">();

/** Fire-and-forget resolve — runs in background, results delivered via IDB + events */
function ensureResolved(
  id: string,
  resolveContent: (id: string) => Promise<{ useServer: boolean; content?: string } | null>,
): void {
  if (_resolveStatus.has(id)) return;
  _resolveStatus.set(id, "resolving");
  resolveContent(id)
    .then(() => {
      _resolveStatus.set(id, "synced");
      EntityStore.emit("resolveComplete", { id });
    })
    .catch(() => {
      _resolveStatus.delete(id);
      EntityStore.emit("resolveError", { id });
    });
}

export function useDocumentEditor({
  id,
  loadContent,
  saveContent,
  flushSync,
  resolveContent,
  transformOnLoad,
  transformOnSave,
  onImageUpload,
  onResolveLink,
  mentions,
  hasAfterMeta = false,
}: UseDocumentEditorOptions) {
  const [charCount, setCharCount] = useState(0);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("idle");
  const [readOnly, setReadOnly] = useState(false);
  const suppressSaveRef = useRef(false);
  const currentDocIdRef = useRef(id);
  const prevIdRef = useRef<string | null>(null);

  // Document state cache
  const stateCacheRef = useRef(new Map<string, EditorState>());

  // Scroll management
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollPositions = useRef(new Map<string, number>());
  const scrollKeyOf = (docId: string | undefined, table: boolean) =>
    table ? `${docId}:t` : (docId ?? "");

  // Save scroll position before switching
  const prevDocIdRef = useRef(id);
  const prevHasAfterMetaRef = useRef(hasAfterMeta);
  if (id !== prevDocIdRef.current || hasAfterMeta !== prevHasAfterMetaRef.current) {
    const container = scrollRef.current;
    const prevId = prevDocIdRef.current;
    if (container && prevId) {
      const key = scrollKeyOf(prevId, prevHasAfterMetaRef.current);
      scrollPositions.current.set(key, container.scrollTop);
    }
    prevDocIdRef.current = id;
    prevHasAfterMetaRef.current = hasAfterMeta;
  }

  // Stable refs — updated in a separate useEffect so that the main effect's
  // cleanup (flushPendingSave) still reads the OLD refs when the document switches.
  const saveContentRef = useRef(saveContent);
  const flushSyncRef = useRef(flushSync);
  useEffect(() => {
    saveContentRef.current = saveContent;
    flushSyncRef.current = flushSync;
  }, [saveContent, flushSync]);

  // Save debounce
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingContentRef = useRef<{ id: string; content: string } | null>(null);

  const doSave = useCallback(() => {
    const pending = pendingContentRef.current;
    if (!pending) return;
    pendingContentRef.current = null;
    saveContentRef.current(pending.id, pending.content);
  }, []);

  const flushPendingSave = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const pending = pendingContentRef.current;
    if (pending) {
      pendingContentRef.current = null;
      saveContentRef.current(pending.id, pending.content, { immediateSync: true });
    } else {
      flushSyncRef.current?.(currentDocIdRef.current);
    }
  }, []);

  // onChange handler for useMarkdownEditor
  const handleChange = useCallback(
    (markdown: string) => {
      if (suppressSaveRef.current) return;
      const docId = currentDocIdRef.current;
      const content = transformOnSave ? transformOnSave(markdown) : markdown;
      pendingContentRef.current = { id: docId, content };
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        saveTimerRef.current = null;
        doSave();
      }, 2000);
    },
    [transformOnSave, doSave],
  );

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
    onChange: handleChange,
    onCharCount: setCharCount,
    readOnly,
    onImageUpload,
    onResolveLink,
    mentions,
  });

  // Flush on page reload / tab close
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      const hasPending = pendingContentRef.current !== null;
      flushPendingSave();
      if (hasPending) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [flushPendingSave]);

  // Main effect: load/switch documents + resolve
  useEffect(() => {
    if (!id) return;

    const cancelledRef = { current: false };
    const isSwitch = prevIdRef.current !== null && prevIdRef.current !== id;
    prevIdRef.current = id;

    // Set sync status based on resolve state
    const status = resolveContent ? _resolveStatus.get(id) : undefined;
    if (!resolveContent || status === "synced") {
      setSyncStatus("idle");
      setReadOnly(false);
    } else {
      setSyncStatus("syncing");
      setReadOnly(true);
    }

    const load = async (docId: string): Promise<string> => {
      const raw = (await loadContent(docId)) || "";
      return transformOnLoad ? await transformOnLoad(raw) : raw;
    };

    if (isSwitch) {
      // Save outgoing document state
      const fromId = currentDocIdRef.current;
      if (fromId !== id) {
        const captured = captureState();
        if (captured) stateCacheRef.current.set(fromId, captured);
      }

      const hasDoc = stateCacheRef.current.has(id);
      const resolveStatus = _resolveStatus.get(id);
      const needsResolve = resolveContent && !resolveStatus;

      if (hasDoc && !needsResolve) {
        // Cache hit & resolved → restore from cache
        currentDocIdRef.current = id;
        if (!resolveContent || _resolveStatus.get(id) === "synced") {
          suppressSaveRef.current = false;
        }
        const cached = stateCacheRef.current.get(id);
        if (cached) restoreState(cached);

        if (resolveContent) ensureResolved(id, resolveContent);
      } else {
        // Invalidate stale cache if exists
        if (hasDoc) stateCacheRef.current.delete(id);

        setReadOnly(true);
        currentDocIdRef.current = id;
        suppressSaveRef.current = true;
        // Immediately show empty doc to prevent flash of old content
        resetContent("");

        load(id).then((content) => {
          if (cancelledRef.current) {
            suppressSaveRef.current = false;
            return;
          }
          if (content) {
            resetContent(content);
          }
          if (!resolveContent || _resolveStatus.get(id) === "synced") {
            suppressSaveRef.current = false;
            setReadOnly(false);
          }
          if (resolveContent) ensureResolved(id, resolveContent);
        });
      }
    } else {
      // Initial load
      if (resolveContent && status !== "synced") {
        suppressSaveRef.current = true;
      }
      load(id).then((content) => {
        if (cancelledRef.current) {
          suppressSaveRef.current = false;
          return;
        }
        currentDocIdRef.current = id;
        resetContent(content);

        if (!resolveContent || _resolveStatus.get(id) === "synced") {
          suppressSaveRef.current = false;
        }
        if (resolveContent) ensureResolved(id, resolveContent);
      });
    }

    // Event listeners for resolve results on the DISPLAYED document
    const onContentResolved = async (event: { id: string; content: string }) => {
      if (event.id !== id || cancelledRef.current) return;
      const content = transformOnLoad ? await transformOnLoad(event.content) : event.content;
      if (cancelledRef.current) return;
      suppressSaveRef.current = true;
      applyContent(content, { addToHistory: true });
    };

    const onResolveComplete = (event: { id: string }) => {
      if (event.id !== id || cancelledRef.current) return;
      suppressSaveRef.current = false;
      setReadOnly(false);
      setSyncStatus((prev) => (prev === "syncing" ? "synced" : prev));
      setTimeout(() => {
        if (cancelledRef.current) return;
        setSyncStatus((prev) => (prev === "synced" ? "idle" : prev));
      }, 400);
    };

    const onResolveError = (event: { id: string }) => {
      if (event.id !== id || cancelledRef.current) return;
      suppressSaveRef.current = false;
      setSyncStatus("error");
      setReadOnly(false);
    };

    if (resolveContent) {
      EntityStore.on("contentResolved", onContentResolved);
      EntityStore.on("resolveComplete", onResolveComplete);
      EntityStore.on("resolveError", onResolveError);
    }

    return () => {
      cancelledRef.current = true;
      if (resolveContent) {
        EntityStore.off("contentResolved", onContentResolved);
        EntityStore.off("resolveComplete", onResolveComplete);
        EntityStore.off("resolveError", onResolveError);
      }
      flushPendingSave();
    };
  }, [
    id,
    loadContent,
    resolveContent,
    transformOnLoad,
    flushPendingSave,
    captureState,
    restoreState,
    resetContent,
    applyContent,
  ]);

  // Invalidate cache for non-displayed documents when contentResolved fires
  useEffect(() => {
    if (!resolveContent) return;
    const handler = (event: { id: string }) => {
      if (event.id === prevIdRef.current) return;
      stateCacheRef.current.delete(event.id);
      scrollPositions.current.delete(event.id);
      scrollPositions.current.delete(`${event.id}:t`);
    };
    EntityStore.on("contentResolved", handler);
    return () => EntityStore.off("contentResolved", handler);
  }, [resolveContent]);

  // Restore scroll position after document switch
  const prevScrollKeyRef = useRef(scrollKeyOf(id, hasAfterMeta));
  useEffect(() => {
    const key = scrollKeyOf(id, hasAfterMeta);
    if (key === prevScrollKeyRef.current) return;
    prevScrollKeyRef.current = key;

    const container = scrollRef.current;
    if (!container || !id) return;

    const saved = scrollPositions.current.get(key);
    const target = saved ?? 0;
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
  }, [id, hasAfterMeta]);

  return {
    editor,
    mode,
    setMode,
    rawMarkdown,
    setRawMarkdown,
    charCount,
    scrollRef,
    readOnly,
    syncStatus,
    flushPendingSave,
  };
}
