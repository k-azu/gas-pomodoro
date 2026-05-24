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
import type { EditorState, MentionTrigger } from "../editor/markweaveEditor";
import { useMarkdownEditor } from "./useMarkdownEditor";
import type { SyncStatus } from "../components/shared/SyncIndicator";
import * as EntityStore from "../lib/entityStore";

interface UseDocumentEditorOptions {
  scope: string;
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

const docKeyOf = (scope: string, id: string | undefined) => `${scope}:${id ?? ""}`;

/** Fire-and-forget resolve — runs in background, results delivered via IDB + events */
function ensureResolved(
  scope: string,
  id: string,
  resolveContent: (id: string) => Promise<{ useServer: boolean; content?: string } | null>,
): void {
  const docKey = docKeyOf(scope, id);
  if (_resolveStatus.has(docKey)) return;
  _resolveStatus.set(docKey, "resolving");
  resolveContent(id)
    .then(() => {
      _resolveStatus.set(docKey, "synced");
      EntityStore.emit("resolveComplete", { scope, id });
    })
    .catch(() => {
      _resolveStatus.delete(docKey);
      EntityStore.emit("resolveError", { scope, id });
    });
}

export function useDocumentEditor({
  scope,
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
  const currentDocKeyRef = useRef(docKeyOf(scope, id));
  const prevDocKeyRef = useRef<string | null>(null);
  const currentDocKey = docKeyOf(scope, id);

  // Document state cache
  const stateCacheRef = useRef(new Map<string, EditorState>());

  // Scroll management
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollPositions = useRef(new Map<string, number>());
  const scrollKeyOf = (docKey: string | undefined, table: boolean) =>
    table ? `${docKey}:t` : (docKey ?? "");

  // Save scroll position before switching
  const prevScrollDocKeyRef = useRef(currentDocKey);
  const prevHasAfterMetaRef = useRef(hasAfterMeta);
  if (
    currentDocKey !== prevScrollDocKeyRef.current ||
    hasAfterMeta !== prevHasAfterMetaRef.current
  ) {
    const container = scrollRef.current;
    const prevDocKey = prevScrollDocKeyRef.current;
    if (container && prevDocKey) {
      const key = scrollKeyOf(prevDocKey, prevHasAfterMetaRef.current);
      scrollPositions.current.set(key, container.scrollTop);
    }
    prevScrollDocKeyRef.current = currentDocKey;
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
  const pendingContentRef = useRef<{
    scope: string;
    id: string;
    content: string;
    saveContent: typeof saveContent;
  } | null>(null);
  const failedContentRef = useRef(
    new Map<
      string,
      { scope: string; id: string; content: string; saveContent: typeof saveContent }
    >(),
  );
  const savingSeqRef = useRef(0);
  const transformErrorDocKeysRef = useRef(new Set<string>());

  const reportSaveError = useCallback(() => {
    setSyncStatus("error");
  }, []);

  const savePending = useCallback(
    (
      pending: { scope: string; id: string; content: string; saveContent: typeof saveContent },
      opts?: { immediateSync?: boolean },
    ) => {
      const saveSeq = ++savingSeqRef.current;
      const docKey = docKeyOf(pending.scope, pending.id);
      return pending.saveContent(pending.id, pending.content, opts).catch((err) => {
        console.error("[useDocumentEditor] Failed to save content:", err);
        const latest = pendingContentRef.current;
        if (!latest || docKeyOf(latest.scope, latest.id) !== docKey) {
          failedContentRef.current.set(docKey, pending);
        }
        if (savingSeqRef.current === saveSeq) reportSaveError();
      });
    },
    [reportSaveError, saveContent],
  );

  const doSave = useCallback(() => {
    const pending = pendingContentRef.current;
    if (!pending) return;
    pendingContentRef.current = null;
    void savePending(pending);
  }, [savePending]);

  const flushPendingSave = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const pending = pendingContentRef.current;
    if (pending) {
      pendingContentRef.current = null;
      void savePending(pending, { immediateSync: true });
    }

    const failedSaves = Array.from(failedContentRef.current.values());
    failedContentRef.current.clear();
    failedSaves.forEach((failed) => {
      void savePending(failed, { immediateSync: true });
    });

    if (!pending && failedSaves.length === 0) {
      flushSyncRef.current?.(currentDocIdRef.current);
    }
  }, [savePending]);

  // onChange handler for useMarkdownEditor
  const handleChange = useCallback(
    (markdown: string) => {
      if (suppressSaveRef.current) return;
      const docId = currentDocIdRef.current;
      const content = transformOnSave ? transformOnSave(markdown) : markdown;
      const docKey = docKeyOf(scope, docId);
      failedContentRef.current.delete(docKey);
      transformErrorDocKeysRef.current.delete(docKey);
      pendingContentRef.current = {
        scope,
        id: docId,
        content,
        saveContent: saveContentRef.current,
      };
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        saveTimerRef.current = null;
        doSave();
      }, 2000);
    },
    [scope, transformOnSave, doSave],
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
      const hasPending = pendingContentRef.current !== null || failedContentRef.current.size > 0;
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
    const docKey = docKeyOf(scope, id);
    const isSwitch = prevDocKeyRef.current !== null && prevDocKeyRef.current !== docKey;
    prevDocKeyRef.current = docKey;

    // Set sync status based on resolve state
    const status = resolveContent ? _resolveStatus.get(docKey) : undefined;
    if (!resolveContent || status === "synced") {
      setSyncStatus("idle");
      setReadOnly(false);
    } else {
      setSyncStatus("syncing");
      setReadOnly(true);
    }

    const transformLoadedContent = async (
      raw: string,
    ): Promise<{ content: string; transformError?: unknown }> => {
      if (!transformOnLoad) return { content: raw };
      try {
        return { content: await transformOnLoad(raw) };
      } catch (err) {
        return { content: raw, transformError: err };
      }
    };

    const load = async (docId: string): Promise<{ content: string; transformError?: unknown }> => {
      const raw = (await loadContent(docId)) || "";
      return transformLoadedContent(raw);
    };

    let applyingResolvedContent = false;
    let resolveCompleteReceived = false;

    const markResolveComplete = () => {
      if (cancelledRef.current) return;
      suppressSaveRef.current = false;
      setReadOnly(false);
      setSyncStatus((prev) => (prev === "syncing" ? "synced" : prev));
      setTimeout(() => {
        if (cancelledRef.current) return;
        setSyncStatus((prev) => (prev === "synced" ? "idle" : prev));
      }, 400);
    };

    const markResolveError = () => {
      if (cancelledRef.current) return;
      suppressSaveRef.current = false;
      setSyncStatus("error");
      setReadOnly(false);
    };

    const markLoadError = (err: unknown) => {
      console.error("[useDocumentEditor] Failed to load content:", err);
      if (cancelledRef.current) return;
      suppressSaveRef.current = false;
      setSyncStatus("error");
      setReadOnly(true);
    };

    const markTransformError = (err: unknown) => {
      console.error("[useDocumentEditor] Failed to transform loaded content:", err);
      if (cancelledRef.current) return;
      transformErrorDocKeysRef.current.add(docKey);
      suppressSaveRef.current = false;
      setSyncStatus("error");
      setReadOnly(false);
    };

    if (isSwitch) {
      // Save outgoing document state
      const fromDocKey = currentDocKeyRef.current;
      if (fromDocKey !== docKey) {
        const captured = captureState();
        if (captured) stateCacheRef.current.set(fromDocKey, captured);
      }

      const hasDoc = stateCacheRef.current.has(docKey);
      const resolveStatus = _resolveStatus.get(docKey);
      const needsResolve = resolveContent && !resolveStatus;

      if (hasDoc && !needsResolve) {
        // Cache hit & resolved → restore from cache
        currentDocIdRef.current = id;
        currentDocKeyRef.current = docKey;
        if (!resolveContent || _resolveStatus.get(docKey) === "synced") {
          suppressSaveRef.current = false;
        }
        const cached = stateCacheRef.current.get(docKey);
        if (cached) restoreState(cached);

        if (resolveContent) ensureResolved(scope, id, resolveContent);
      } else {
        // Invalidate stale cache if exists
        if (hasDoc) stateCacheRef.current.delete(docKey);

        setReadOnly(true);
        currentDocIdRef.current = id;
        currentDocKeyRef.current = docKey;
        suppressSaveRef.current = true;

        load(id)
          .then(({ content, transformError }) => {
            if (cancelledRef.current) {
              suppressSaveRef.current = false;
              return;
            }
            currentDocKeyRef.current = docKey;
            resetContent(content);
            if (transformError) {
              markTransformError(transformError);
            } else {
              transformErrorDocKeysRef.current.delete(docKey);
            }
            if (!resolveContent || _resolveStatus.get(docKey) === "synced") {
              suppressSaveRef.current = false;
              if (!transformError) setReadOnly(false);
            }
            if (resolveContent) ensureResolved(scope, id, resolveContent);
          })
          .catch(markLoadError);
      }
    } else {
      // Initial load
      if (resolveContent && status !== "synced") {
        suppressSaveRef.current = true;
      }
      load(id)
        .then(({ content, transformError }) => {
          if (cancelledRef.current) {
            suppressSaveRef.current = false;
            return;
          }
          currentDocIdRef.current = id;
          currentDocKeyRef.current = docKey;
          resetContent(content);
          if (transformError) {
            markTransformError(transformError);
          } else {
            transformErrorDocKeysRef.current.delete(docKey);
          }

          if (!resolveContent || _resolveStatus.get(docKey) === "synced") {
            suppressSaveRef.current = false;
            if (!transformError) setReadOnly(false);
          }
          if (resolveContent) ensureResolved(scope, id, resolveContent);
        })
        .catch(markLoadError);
    }

    // Event listeners for resolve results on the DISPLAYED document
    const onContentResolved = async (event: {
      storeName?: string;
      id: string;
      content: string;
    }) => {
      if (event.storeName !== scope || event.id !== id || cancelledRef.current) return;
      applyingResolvedContent = true;
      let transformError: unknown;
      try {
        const transformed = await transformLoadedContent(event.content);
        const content = transformed.content;
        transformError = transformed.transformError;
        if (cancelledRef.current) return;
        suppressSaveRef.current = true;
        applyContent(content, { addToHistory: true });
        applyingResolvedContent = false;
        if (transformError) {
          _resolveStatus.delete(docKey);
          markTransformError(transformError);
          return;
        }
        transformErrorDocKeysRef.current.delete(docKey);
        if (resolveCompleteReceived) markResolveComplete();
      } catch (err) {
        console.error("[useDocumentEditor] Failed to apply resolved content:", err);
        applyingResolvedContent = false;
        _resolveStatus.delete(docKey);
        markResolveError();
      }
    };

    const onResolveComplete = (event: { scope?: string; id: string }) => {
      if (event.scope !== scope || event.id !== id || cancelledRef.current) return;
      if (transformErrorDocKeysRef.current.has(docKey)) return;
      if (applyingResolvedContent) {
        resolveCompleteReceived = true;
        return;
      }
      markResolveComplete();
    };

    const onResolveError = (event: { scope?: string; id: string }) => {
      if (event.scope !== scope || event.id !== id || cancelledRef.current) return;
      markResolveError();
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
    scope,
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
    const handler = (event: { storeName?: string; id: string }) => {
      if (event.storeName !== scope) return;
      const eventDocKey = docKeyOf(scope, event.id);
      if (eventDocKey === currentDocKey) return;
      stateCacheRef.current.delete(eventDocKey);
      scrollPositions.current.delete(eventDocKey);
      scrollPositions.current.delete(`${eventDocKey}:t`);
    };
    EntityStore.on("contentResolved", handler);
    return () => EntityStore.off("contentResolved", handler);
  }, [currentDocKey, resolveContent, scope]);

  // Restore scroll position after document switch
  const prevScrollKeyRef = useRef(scrollKeyOf(currentDocKey, hasAfterMeta));
  useEffect(() => {
    const key = scrollKeyOf(currentDocKey, hasAfterMeta);
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
  }, [currentDocKey, id, hasAfterMeta]);

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
