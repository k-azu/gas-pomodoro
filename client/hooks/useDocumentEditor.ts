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
import type { EditorState, MentionTrigger } from "../editor/hitomdEditor";
import { useMarkdownEditor } from "./useMarkdownEditor";
import type { SyncStatus } from "../components/shared/SyncIndicator";
import * as EntityStore from "../lib/entityStore";
import { onDocumentCommit } from "../lib/tabSync";

interface UseDocumentEditorOptions {
  scope: string;
  id: string;
  loadContentSnapshot: (id: string) => Promise<EntityStore.ContentSnapshot | null>;
  saveContent: (
    id: string,
    content: string,
    opts?: EntityStore.ContentSaveOptions,
  ) => Promise<void>;
  /** Flush server sync for the given id (bypass 30s debounce) */
  flushSync?: (id: string) => void;
  resolveContent?: (
    id: string,
  ) => Promise<{ useServer: boolean; content?: string; revision?: number } | null>;
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

// Track resolve status per document in this session
const _resolveStatus = new Map<string, "resolving" | "synced">();

const docKeyOf = (scope: string, id: string | undefined) => `${scope}:${id ?? ""}`;

/** Fire-and-forget resolve — runs in background, results delivered via IDB + events */
function ensureResolved(
  scope: string,
  id: string,
  resolveContent: (
    id: string,
  ) => Promise<{ useServer: boolean; content?: string; revision?: number } | null>,
): void {
  const docKey = docKeyOf(scope, id);
  if (_resolveStatus.has(docKey)) return;
  _resolveStatus.set(docKey, "resolving");
  resolveContent(id)
    .then((result) => {
      _resolveStatus.set(docKey, "synced");
      EntityStore.emit("resolveComplete", { scope, id, revision: result?.revision });
    })
    .catch(() => {
      _resolveStatus.delete(docKey);
      EntityStore.emit("resolveError", { scope, id });
    });
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
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("idle");
  const [readOnly, setReadOnly] = useState(false);
  const [contentRevision, setContentRevision] = useState(0);
  const [conflict, setConflict] = useState<EntityStore.ContentConflictSnapshot | null>(null);
  const suppressSaveRef = useRef(false);
  const currentDocIdRef = useRef(id);
  const currentDocKeyRef = useRef(docKeyOf(scope, id));
  const prevDocKeyRef = useRef<string | null>(null);
  const currentDocKey = docKeyOf(scope, id);
  const baseRevisionRef = useRef(0);
  const editorDirtyRef = useRef(false);
  const latestContentRef = useRef("");

  // Document state cache
  const stateCacheRef = useRef(new Map<string, EditorState>());
  const contentCacheRef = useRef(new Map<string, string>());
  const revisionCacheRef = useRef(new Map<string, number>());
  const dirtyCacheRef = useRef(new Map<string, boolean>());

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
    baseRevision: number;
    mutationId: string;
    saveContent: typeof saveContent;
  } | null>(null);
  const failedContentRef = useRef(
    new Map<
      string,
      {
        scope: string;
        id: string;
        content: string;
        baseRevision: number;
        mutationId: string;
        saveContent: typeof saveContent;
      }
    >(),
  );
  const savingSeqRef = useRef(0);
  const transformErrorDocKeysRef = useRef(new Set<string>());

  const reportSaveError = useCallback(() => {
    setSyncStatus("error");
  }, []);

  const savePending = useCallback(
    (
      pending: {
        scope: string;
        id: string;
        content: string;
        baseRevision: number;
        mutationId: string;
        saveContent: typeof saveContent;
      },
      opts?: EntityStore.ContentSaveOptions,
    ) => {
      const saveSeq = ++savingSeqRef.current;
      const docKey = docKeyOf(pending.scope, pending.id);
      return pending
        .saveContent(pending.id, pending.content, {
          ...opts,
          baseRevision: pending.baseRevision,
          mutationId: pending.mutationId,
        })
        .catch((err) => {
          console.error("[useDocumentEditor] Failed to save content:", err);
          const latest = pendingContentRef.current;
          if (!latest || docKeyOf(latest.scope, latest.id) !== docKey) {
            failedContentRef.current.set(docKey, pending);
          }
          if (savingSeqRef.current === saveSeq) reportSaveError();
        });
    },
    [reportSaveError],
  );

  const doSave = useCallback(() => {
    const pending = pendingContentRef.current;
    if (!pending) return;
    pendingContentRef.current = null;
    void savePending(pending, { immediateSync: true });
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
      if (suppressSaveRef.current || forceReadOnly) return;
      const docId = currentDocIdRef.current;
      const content = transformOnSave ? transformOnSave(markdown) : markdown;
      const docKey = docKeyOf(scope, docId);
      failedContentRef.current.delete(docKey);
      transformErrorDocKeysRef.current.delete(docKey);
      editorDirtyRef.current = true;
      latestContentRef.current = content;
      contentCacheRef.current.set(docKey, content);
      setConflict(null);
      pendingContentRef.current = {
        scope,
        id: docId,
        content,
        baseRevision: baseRevisionRef.current,
        mutationId: crypto.randomUUID(),
        saveContent: saveContentRef.current,
      };
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        saveTimerRef.current = null;
        doSave();
      }, 2000);
    },
    [scope, transformOnSave, doSave, forceReadOnly],
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
    readOnly: readOnly || forceReadOnly,
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

    const load = async (
      docId: string,
    ): Promise<{
      content: string;
      revision: number;
      dirty: boolean;
      conflict?: EntityStore.ContentConflictSnapshot;
      transformError?: unknown;
    }> => {
      const snapshot = await loadContentSnapshot(docId);
      const transformed = await transformLoadedContent(snapshot?.content || "");
      return {
        ...transformed,
        revision: Math.max(0, snapshot?.revision ?? 0),
        dirty: Boolean(snapshot?.dirty),
        conflict: snapshot?.conflict,
      };
    };

    const restoreConflictState = (restoredConflict?: EntityStore.ContentConflictSnapshot) => {
      if (restoredConflict) {
        setConflict(restoredConflict);
        setSyncStatus("conflict");
      } else {
        setConflict(null);
      }
    };

    const rememberLoadedSnapshot = (
      content: string,
      revision: number,
      dirty: boolean,
      restoredConflict?: EntityStore.ContentConflictSnapshot,
    ) => {
      baseRevisionRef.current = revision;
      editorDirtyRef.current = dirty;
      latestContentRef.current = transformOnSave ? transformOnSave(content) : content;
      contentCacheRef.current.set(docKey, latestContentRef.current);
      revisionCacheRef.current.set(docKey, revision);
      dirtyCacheRef.current.set(docKey, dirty);
      restoreConflictState(restoredConflict);
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
        contentCacheRef.current.set(fromDocKey, latestContentRef.current);
        revisionCacheRef.current.set(fromDocKey, baseRevisionRef.current);
        dirtyCacheRef.current.set(fromDocKey, editorDirtyRef.current);
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
        if (cached) {
          restoreState(cached);
          latestContentRef.current = contentCacheRef.current.get(docKey) || "";
          baseRevisionRef.current = revisionCacheRef.current.get(docKey) ?? 0;
          editorDirtyRef.current = dirtyCacheRef.current.get(docKey) || false;
          restoreConflictState();
          setContentRevision((revision) => revision + 1);
        }

        void loadContentSnapshot(id)
          .then((snapshot) => {
            if (!cancelledRef.current && snapshot?.conflict) {
              restoreConflictState(snapshot.conflict);
            }
          })
          .catch((err) => {
            console.warn("[useDocumentEditor] Failed to restore persisted conflict:", err);
          });

        if (resolveContent) ensureResolved(scope, id, resolveContent);
      } else {
        // Invalidate stale cache if exists
        if (hasDoc) stateCacheRef.current.delete(docKey);

        setReadOnly(true);
        currentDocIdRef.current = id;
        currentDocKeyRef.current = docKey;
        suppressSaveRef.current = true;

        load(id)
          .then(({ content, revision, dirty, conflict: restoredConflict, transformError }) => {
            if (cancelledRef.current) {
              suppressSaveRef.current = false;
              return;
            }
            currentDocKeyRef.current = docKey;
            resetContent(content);
            rememberLoadedSnapshot(content, revision, dirty, restoredConflict);
            setContentRevision((revision) => revision + 1);
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
        .then(({ content, revision, dirty, conflict: restoredConflict, transformError }) => {
          if (cancelledRef.current) {
            suppressSaveRef.current = false;
            return;
          }
          currentDocIdRef.current = id;
          currentDocKeyRef.current = docKey;
          resetContent(content);
          rememberLoadedSnapshot(content, revision, dirty, restoredConflict);
          setContentRevision((revision) => revision + 1);
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
      revision?: number;
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
        const revision = Math.max(1, event.revision || 1);
        baseRevisionRef.current = revision;
        editorDirtyRef.current = false;
        latestContentRef.current = transformOnSave ? transformOnSave(content) : content;
        contentCacheRef.current.set(docKey, latestContentRef.current);
        revisionCacheRef.current.set(docKey, revision);
        dirtyCacheRef.current.set(docKey, false);
        setContentRevision((revision) => revision + 1);
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

    const onResolveComplete = (event: { scope?: string; id: string; revision?: number }) => {
      if (event.scope !== scope || event.id !== id || cancelledRef.current) return;
      if (transformErrorDocKeysRef.current.has(docKey)) return;
      if (applyingResolvedContent) {
        resolveCompleteReceived = true;
        return;
      }
      if (!editorDirtyRef.current && event.revision) {
        baseRevisionRef.current = event.revision;
        revisionCacheRef.current.set(docKey, event.revision);
      }
      markResolveComplete();
    };

    const onResolveError = (event: { scope?: string; id: string }) => {
      if (event.scope !== scope || event.id !== id || cancelledRef.current) return;
      markResolveError();
    };

    const applyRemoteSnapshot = async (content: string, revision: number, updatedAt: string) => {
      if (cancelledRef.current || revision <= baseRevisionRef.current) return;
      if (editorDirtyRef.current || pendingContentRef.current) {
        setConflict({ content, revision, updatedAt });
        setSyncStatus("conflict");
        return;
      }
      const transformed = await transformLoadedContent(content);
      if (cancelledRef.current) return;
      // Transforming Drive images can be asynchronous. Re-check state after it
      // completes so an older snapshot cannot overwrite a newer commit or edits
      // made while the transform was running.
      if (revision <= baseRevisionRef.current) return;
      if (editorDirtyRef.current || pendingContentRef.current) {
        setConflict({ content, revision, updatedAt });
        setSyncStatus("conflict");
        return;
      }
      if (transformed.transformError) {
        markTransformError(transformed.transformError);
        return;
      }
      suppressSaveRef.current = true;
      applyContent(transformed.content, { addToHistory: true });
      baseRevisionRef.current = revision;
      editorDirtyRef.current = false;
      latestContentRef.current = transformOnSave
        ? transformOnSave(transformed.content)
        : transformed.content;
      contentCacheRef.current.set(docKey, latestContentRef.current);
      revisionCacheRef.current.set(docKey, revision);
      dirtyCacheRef.current.set(docKey, false);
      setContentRevision((value) => value + 1);
      setSyncStatus("synced");
      setTimeout(() => {
        if (!cancelledRef.current) setSyncStatus((value) => (value === "synced" ? "idle" : value));
      }, 400);
      suppressSaveRef.current = false;
    };

    const onContentCommitted = (event: {
      storeName: string;
      id: string;
      content: string;
      revision: number;
      updatedAt: string;
      mutationId: string;
    }) => {
      if (event.storeName !== scope || event.id !== id || cancelledRef.current) return;
      baseRevisionRef.current = event.revision;
      revisionCacheRef.current.set(docKey, event.revision);
      if (pendingContentRef.current) {
        pendingContentRef.current.baseRevision = event.revision;
      }
      if (event.content === latestContentRef.current && !pendingContentRef.current) {
        editorDirtyRef.current = false;
        dirtyCacheRef.current.set(docKey, false);
        setConflict(null);
        setSyncStatus("synced");
        setTimeout(() => {
          if (!cancelledRef.current) {
            setSyncStatus((value) => (value === "synced" ? "idle" : value));
          }
        }, 400);
      }
    };

    const onContentConflict = (event: {
      storeName: string;
      id: string;
      content: string;
      revision: number;
      updatedAt: string;
    }) => {
      if (event.storeName !== scope || event.id !== id || cancelledRef.current) return;
      setConflict({
        content: event.content,
        revision: event.revision,
        updatedAt: event.updatedAt,
      });
      setSyncStatus("conflict");
    };

    const unsubscribeTabSync = onDocumentCommit((message) => {
      if (message.storeName !== scope || message.id !== id || cancelledRef.current) return;
      void EntityStore.getCommittedContentSnapshot(scope, id).then((snapshot) => {
        if (!snapshot || snapshot.revision < message.revision) return;
        return applyRemoteSnapshot(snapshot.content, snapshot.revision, message.updatedAt);
      });
    });

    const checkForMissedCommit = () => {
      if (document.visibilityState === "hidden") return;
      void EntityStore.getCommittedContentSnapshot(scope, id).then((snapshot) => {
        if (!snapshot) return;
        return applyRemoteSnapshot(snapshot.content, snapshot.revision, "");
      });
    };

    EntityStore.on("contentCommitted", onContentCommitted);
    EntityStore.on("contentConflict", onContentConflict);
    window.addEventListener("focus", checkForMissedCommit);
    document.addEventListener("visibilitychange", checkForMissedCommit);

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
      unsubscribeTabSync();
      EntityStore.off("contentCommitted", onContentCommitted);
      EntityStore.off("contentConflict", onContentConflict);
      window.removeEventListener("focus", checkForMissedCommit);
      document.removeEventListener("visibilitychange", checkForMissedCommit);
      flushPendingSave();
    };
  }, [
    id,
    scope,
    loadContentSnapshot,
    resolveContent,
    transformOnLoad,
    transformOnSave,
    flushPendingSave,
    captureState,
    restoreState,
    resetContent,
    applyContent,
  ]);

  // Keep document-switch caches coherent when a save completes while another
  // document is displayed. Remote commits with different content invalidate the
  // cached editor state so the next selection reloads the committed snapshot (or
  // this tab's own draft) from IndexedDB.
  useEffect(() => {
    const handleBackgroundCommit = (event: {
      storeName: string;
      id: string;
      content: string;
      revision: number;
    }) => {
      if (event.storeName !== scope) return;
      const eventDocKey = docKeyOf(scope, event.id);
      if (eventDocKey === currentDocKey) return;

      revisionCacheRef.current.set(eventDocKey, event.revision);
      if (contentCacheRef.current.get(eventDocKey) === event.content) {
        dirtyCacheRef.current.set(eventDocKey, false);
        return;
      }

      stateCacheRef.current.delete(eventDocKey);
      contentCacheRef.current.delete(eventDocKey);
      dirtyCacheRef.current.delete(eventDocKey);
      _resolveStatus.delete(eventDocKey);
    };

    const handleBackgroundConflict = (event: { storeName: string; id: string }) => {
      if (event.storeName !== scope) return;
      const eventDocKey = docKeyOf(scope, event.id);
      if (eventDocKey === currentDocKey) return;
      stateCacheRef.current.delete(eventDocKey);
    };

    const unsubscribeTabSync = onDocumentCommit((message) => {
      if (message.storeName !== scope) return;
      const eventDocKey = docKeyOf(scope, message.id);
      if (eventDocKey === currentDocKey) return;
      void EntityStore.getCommittedContentSnapshot(scope, message.id).then((snapshot) => {
        if (!snapshot || snapshot.revision < message.revision) return;
        handleBackgroundCommit({
          storeName: scope,
          id: message.id,
          content: snapshot.content,
          revision: snapshot.revision,
        });
      });
    });
    EntityStore.on("contentCommitted", handleBackgroundCommit);
    EntityStore.on("contentConflict", handleBackgroundConflict);
    return () => {
      unsubscribeTabSync();
      EntityStore.off("contentCommitted", handleBackgroundCommit);
      EntityStore.off("contentConflict", handleBackgroundConflict);
    };
  }, [currentDocKey, scope]);

  // Invalidate cache for non-displayed documents when contentResolved fires
  useEffect(() => {
    if (!resolveContent) return;
    const handler = (event: { storeName?: string; id: string }) => {
      if (event.storeName !== scope) return;
      const eventDocKey = docKeyOf(scope, event.id);
      if (eventDocKey === currentDocKey) return;
      stateCacheRef.current.delete(eventDocKey);
      contentCacheRef.current.delete(eventDocKey);
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

  const acceptRemoteContent = useCallback(async () => {
    if (!conflict) return;
    const acceptingDocId = currentDocIdRef.current;
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    pendingContentRef.current = null;
    failedContentRef.current.delete(currentDocKey);
    try {
      const accepted = await EntityStore.acceptCommittedContent(
        scope,
        currentDocIdRef.current,
        conflict.content,
        conflict.revision,
        conflict.updatedAt,
      );
      if (!accepted || currentDocIdRef.current !== acceptingDocId) return;

      // The user's click discards the old local draft. Advance the edit base
      // before the potentially asynchronous image transform so any new input is
      // recorded as a fresh draft on top of the accepted revision.
      baseRevisionRef.current = accepted.revision;
      editorDirtyRef.current = false;
      revisionCacheRef.current.set(currentDocKey, accepted.revision);
      dirtyCacheRef.current.set(currentDocKey, false);
      setConflict(null);
      setSyncStatus("syncing");

      const transformed = transformOnLoad
        ? await transformOnLoad(accepted.content)
        : accepted.content;

      if (currentDocIdRef.current !== acceptingDocId) return;
      if (accepted.revision < baseRevisionRef.current) return;
      if (editorDirtyRef.current || pendingContentRef.current) {
        setConflict({
          content: accepted.content,
          revision: accepted.revision,
          updatedAt: conflict.updatedAt,
        });
        setSyncStatus("conflict");
        return;
      }

      suppressSaveRef.current = true;
      applyContent(transformed, { addToHistory: true });
      latestContentRef.current = transformOnSave ? transformOnSave(transformed) : transformed;
      contentCacheRef.current.set(currentDocKey, latestContentRef.current);
      setContentRevision((value) => value + 1);
      setSyncStatus("idle");
    } catch (err) {
      console.error("[useDocumentEditor] Failed to accept remote content:", err);
      setSyncStatus("error");
    } finally {
      suppressSaveRef.current = false;
    }
  }, [applyContent, conflict, currentDocKey, scope, transformOnLoad, transformOnSave]);

  const keepLocalContent = useCallback(() => {
    if (!conflict) return;
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    pendingContentRef.current = null;
    failedContentRef.current.delete(currentDocKey);
    const pending = {
      scope,
      id: currentDocIdRef.current,
      content: latestContentRef.current,
      baseRevision: conflict.revision,
      mutationId: crypto.randomUUID(),
      saveContent: saveContentRef.current,
    };
    baseRevisionRef.current = conflict.revision;
    revisionCacheRef.current.set(currentDocKey, conflict.revision);
    setConflict(null);
    setSyncStatus("syncing");
    void savePending(pending, { immediateSync: true });
  }, [conflict, currentDocKey, savePending, scope]);

  return {
    editor,
    mode,
    setMode,
    rawMarkdown,
    setRawMarkdown,
    charCount,
    scrollRef,
    readOnly: readOnly || forceReadOnly,
    syncStatus,
    contentRevision,
    flushPendingSave,
    conflict,
    acceptRemoteContent,
    keepLocalContent,
  };
}
