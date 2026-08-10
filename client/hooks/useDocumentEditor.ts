/**
 * useDocumentEditor — composed hook for document-switching editors
 *
 * Composes the editor adapter, document session state, save queue, view cache,
 * and the typed synchronization gateway.
 *
 * Consumers get {editor, mode, setMode, rawMarkdown, setRawMarkdown, charCount,
 * scrollRef, readOnly, syncStatus, flushPendingSave} — no refs, no indirection.
 */
import { useState, useEffect, useCallback, useRef } from "react";
import type { MentionTrigger } from "../editor/hitomdEditor";
import { useMarkdownEditor } from "./useMarkdownEditor";
import {
  acceptCommittedContent,
  documentKey,
  ensureDocumentResolved,
  getCommittedContentSnapshot,
  getResolveStatus,
  invalidateResolveStatus,
  subscribeDocumentSync,
  type ContentConflictSnapshot,
  type ContentSnapshot,
  type ResolveDocument,
} from "../lib/documentSync";
import { useDocumentSaveQueue, type SaveDocumentContent } from "./useDocumentSaveQueue";
import { useDocumentSession } from "./useDocumentSession";
import { useDocumentViewCache } from "./useDocumentViewCache";

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
  // UI generation counter used to recompute search highlights after content replacement.
  const [contentVersion, setContentVersion] = useState(0);
  const [{ syncStatus, readOnly, conflict }, dispatchSession] = useDocumentSession();
  const suppressSaveRef = useRef(false);
  const currentDocIdRef = useRef(id);
  const currentDocKeyRef = useRef(documentKey(scope, id));
  const prevDocKeyRef = useRef<string | null>(null);
  const currentDocKey = documentKey(scope, id);
  const baseRevisionRef = useRef(0);
  const editorDirtyRef = useRef(false);
  const latestContentRef = useRef("");
  const viewCache = useDocumentViewCache();

  // Scroll management
  const scrollRef = useRef<HTMLDivElement>(null);

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
      const key = viewCache.scrollKey(prevDocKey, prevHasAfterMetaRef.current);
      viewCache.saveScroll(key, container.scrollTop);
    }
    prevScrollDocKeyRef.current = currentDocKey;
    prevHasAfterMetaRef.current = hasAfterMeta;
  }

  const transformErrorDocKeysRef = useRef(new Set<string>());

  const reportSaveError = useCallback(() => {
    dispatchSession({ type: "syncError" });
  }, [dispatchSession]);
  const {
    queueSave,
    saveImmediately,
    flushPendingSave,
    clear: clearPendingSave,
    forgetFailure,
    hasPending,
    advancePendingRevision,
  } = useDocumentSaveQueue({
    currentDocIdRef,
    saveContent,
    flushSync,
    onError: reportSaveError,
  });

  // onChange handler for useMarkdownEditor
  const handleChange = useCallback(
    (markdown: string) => {
      if (suppressSaveRef.current || forceReadOnly) return;
      const docId = currentDocIdRef.current;
      const content = transformOnSave ? transformOnSave(markdown) : markdown;
      const docKey = documentKey(scope, docId);
      forgetFailure(docKey);
      transformErrorDocKeysRef.current.delete(docKey);
      editorDirtyRef.current = true;
      latestContentRef.current = content;
      viewCache.update(docKey, { content });
      dispatchSession({ type: "clearConflict" });
      queueSave({
        scope,
        id: docId,
        content,
        baseRevision: baseRevisionRef.current,
        mutationId: crypto.randomUUID(),
      });
    },
    [scope, transformOnSave, forceReadOnly, forgetFailure, queueSave, viewCache, dispatchSession],
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

  // Main effect: load/switch documents + resolve
  useEffect(() => {
    if (!id) return;

    const cancelledRef = { current: false };
    const docKey = documentKey(scope, id);
    const isSwitch = prevDocKeyRef.current !== null && prevDocKeyRef.current !== docKey;
    prevDocKeyRef.current = docKey;

    // Set sync status based on resolve state
    const status = resolveContent ? getResolveStatus(scope, id) : undefined;
    if (!resolveContent || status === "synced") {
      dispatchSession({ type: "ready" });
    } else {
      dispatchSession({ type: "resolving" });
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
      conflict?: ContentConflictSnapshot;
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

    const restoreConflictState = (restoredConflict?: ContentConflictSnapshot) =>
      dispatchSession({ type: "restoreConflict", conflict: restoredConflict });

    const rememberLoadedSnapshot = (
      content: string,
      revision: number,
      dirty: boolean,
      restoredConflict?: ContentConflictSnapshot,
    ) => {
      baseRevisionRef.current = revision;
      editorDirtyRef.current = dirty;
      latestContentRef.current = transformOnSave ? transformOnSave(content) : content;
      viewCache.set(docKey, {
        content: latestContentRef.current,
        revision,
        dirty,
      });
      restoreConflictState(restoredConflict);
    };

    let applyingResolvedContent = false;
    let resolveCompleteReceived = false;

    const markResolveComplete = () => {
      if (cancelledRef.current) return;
      suppressSaveRef.current = false;
      dispatchSession({ type: "resolveComplete" });
      setTimeout(() => {
        if (cancelledRef.current) return;
        dispatchSession({ type: "settleSynced" });
      }, 400);
    };

    const markResolveError = () => {
      if (cancelledRef.current) return;
      suppressSaveRef.current = false;
      dispatchSession({ type: "resolveError" });
    };

    const markLoadError = (err: unknown) => {
      console.error("[useDocumentEditor] Failed to load content:", err);
      if (cancelledRef.current) return;
      suppressSaveRef.current = false;
      dispatchSession({ type: "loadError" });
    };

    const markTransformError = (err: unknown) => {
      console.error("[useDocumentEditor] Failed to transform loaded content:", err);
      if (cancelledRef.current) return;
      transformErrorDocKeysRef.current.add(docKey);
      suppressSaveRef.current = false;
      dispatchSession({ type: "transformError" });
    };

    if (isSwitch) {
      // Save outgoing document state
      const fromDocKey = currentDocKeyRef.current;
      if (fromDocKey !== docKey) {
        const captured = captureState();
        viewCache.set(fromDocKey, {
          editorState: captured ?? undefined,
          content: latestContentRef.current,
          revision: baseRevisionRef.current,
          dirty: editorDirtyRef.current,
        });
      }

      const hasDoc = Boolean(viewCache.get(docKey)?.editorState);
      const resolveStatus = getResolveStatus(scope, id);
      const needsResolve = resolveContent && !resolveStatus;

      if (hasDoc && !needsResolve) {
        // Cache hit & resolved → restore from cache
        currentDocIdRef.current = id;
        currentDocKeyRef.current = docKey;
        if (!resolveContent || getResolveStatus(scope, id) === "synced") {
          suppressSaveRef.current = false;
        }
        const cached = viewCache.get(docKey);
        if (cached?.editorState) {
          restoreState(cached.editorState);
          latestContentRef.current = cached.content;
          baseRevisionRef.current = cached.revision;
          editorDirtyRef.current = cached.dirty;
          restoreConflictState();
          setContentVersion((version) => version + 1);
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

        if (resolveContent) ensureDocumentResolved(scope, id, resolveContent);
      } else {
        // Invalidate stale cache if exists
        if (hasDoc) viewCache.invalidate(docKey);

        dispatchSession({ type: "loading" });
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
            setContentVersion((version) => version + 1);
            if (transformError) {
              markTransformError(transformError);
            } else {
              transformErrorDocKeysRef.current.delete(docKey);
            }
            if (!resolveContent || getResolveStatus(scope, id) === "synced") {
              suppressSaveRef.current = false;
              if (!transformError) dispatchSession({ type: "editable" });
            }
            if (resolveContent) ensureDocumentResolved(scope, id, resolveContent);
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
          setContentVersion((version) => version + 1);
          if (transformError) {
            markTransformError(transformError);
          } else {
            transformErrorDocKeysRef.current.delete(docKey);
          }

          if (!resolveContent || getResolveStatus(scope, id) === "synced") {
            suppressSaveRef.current = false;
            if (!transformError) dispatchSession({ type: "editable" });
          }
          if (resolveContent) ensureDocumentResolved(scope, id, resolveContent);
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
        viewCache.update(docKey, {
          content: latestContentRef.current,
          revision,
          dirty: false,
        });
        setContentVersion((version) => version + 1);
        applyingResolvedContent = false;
        if (transformError) {
          invalidateResolveStatus(scope, id);
          markTransformError(transformError);
          return;
        }
        transformErrorDocKeysRef.current.delete(docKey);
        if (resolveCompleteReceived) markResolveComplete();
      } catch (err) {
        console.error("[useDocumentEditor] Failed to apply resolved content:", err);
        applyingResolvedContent = false;
        invalidateResolveStatus(scope, id);
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
        viewCache.update(docKey, { revision: event.revision });
      }
      markResolveComplete();
    };

    const onResolveError = (event: { scope?: string; id: string }) => {
      if (event.scope !== scope || event.id !== id || cancelledRef.current) return;
      markResolveError();
    };

    const applyRemoteSnapshot = async (content: string, revision: number, updatedAt: string) => {
      if (cancelledRef.current || revision <= baseRevisionRef.current) return;
      if (editorDirtyRef.current || hasPending()) {
        dispatchSession({ type: "conflict", conflict: { content, revision, updatedAt } });
        return;
      }
      const transformed = await transformLoadedContent(content);
      if (cancelledRef.current) return;
      // Transforming Drive images can be asynchronous. Re-check state after it
      // completes so an older snapshot cannot overwrite a newer commit or edits
      // made while the transform was running.
      if (revision <= baseRevisionRef.current) return;
      if (editorDirtyRef.current || hasPending()) {
        dispatchSession({ type: "conflict", conflict: { content, revision, updatedAt } });
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
      viewCache.update(docKey, {
        content: latestContentRef.current,
        revision,
        dirty: false,
      });
      setContentVersion((value) => value + 1);
      dispatchSession({ type: "synced" });
      setTimeout(() => {
        if (!cancelledRef.current) dispatchSession({ type: "settleSynced" });
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
      viewCache.update(docKey, { revision: event.revision });
      advancePendingRevision(event.revision);
      if (event.content === latestContentRef.current && !hasPending()) {
        editorDirtyRef.current = false;
        viewCache.update(docKey, { dirty: false });
        dispatchSession({ type: "synced" });
        setTimeout(() => {
          if (!cancelledRef.current) {
            dispatchSession({ type: "settleSynced" });
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
      dispatchSession({
        type: "conflict",
        conflict: {
          content: event.content,
          revision: event.revision,
          updatedAt: event.updatedAt,
        },
      });
    };

    const onTabCommit = (message: {
      storeName: string;
      id: string;
      revision: number;
      updatedAt: string;
    }) => {
      if (message.storeName !== scope || message.id !== id || cancelledRef.current) return;
      void getCommittedContentSnapshot(scope, id).then((snapshot) => {
        if (!snapshot || snapshot.revision < message.revision) return;
        return applyRemoteSnapshot(snapshot.content, snapshot.revision, message.updatedAt);
      });
    };

    const checkForMissedCommit = () => {
      if (document.visibilityState === "hidden") return;
      void getCommittedContentSnapshot(scope, id).then((snapshot) => {
        if (!snapshot) return;
        return applyRemoteSnapshot(snapshot.content, snapshot.revision, "");
      });
    };

    const unsubscribeSync = subscribeDocumentSync({
      contentCommitted: onContentCommitted,
      contentConflict: onContentConflict,
      tabCommit: onTabCommit,
      ...(resolveContent
        ? {
            contentResolved: onContentResolved,
            resolveComplete: onResolveComplete,
            resolveError: onResolveError,
          }
        : {}),
    });
    window.addEventListener("focus", checkForMissedCommit);
    document.addEventListener("visibilitychange", checkForMissedCommit);

    return () => {
      cancelledRef.current = true;
      unsubscribeSync();
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
    advancePendingRevision,
    dispatchSession,
    flushPendingSave,
    hasPending,
    captureState,
    restoreState,
    resetContent,
    applyContent,
    viewCache,
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
      const eventDocKey = documentKey(scope, event.id);
      if (eventDocKey === currentDocKey) return;

      const cached = viewCache.get(eventDocKey);
      viewCache.update(eventDocKey, { revision: event.revision });
      if (cached?.content === event.content) {
        viewCache.update(eventDocKey, { dirty: false });
        return;
      }

      viewCache.invalidate(eventDocKey);
      invalidateResolveStatus(scope, event.id);
    };

    const handleBackgroundConflict = (event: { storeName: string; id: string }) => {
      if (event.storeName !== scope) return;
      const eventDocKey = documentKey(scope, event.id);
      if (eventDocKey === currentDocKey) return;
      viewCache.invalidate(eventDocKey);
    };

    const handleTabCommit = (message: { storeName: string; id: string; revision: number }) => {
      if (message.storeName !== scope) return;
      const eventDocKey = documentKey(scope, message.id);
      if (eventDocKey === currentDocKey) return;
      void getCommittedContentSnapshot(scope, message.id).then((snapshot) => {
        if (!snapshot || snapshot.revision < message.revision) return;
        handleBackgroundCommit({
          storeName: scope,
          id: message.id,
          content: snapshot.content,
          revision: snapshot.revision,
        });
      });
    };
    return subscribeDocumentSync({
      contentCommitted: handleBackgroundCommit,
      contentConflict: handleBackgroundConflict,
      tabCommit: handleTabCommit,
    });
  }, [currentDocKey, scope, viewCache]);

  // Invalidate cache for non-displayed documents when contentResolved fires
  useEffect(() => {
    if (!resolveContent) return;
    const handler = (event: { storeName?: string; id: string }) => {
      if (event.storeName !== scope) return;
      const eventDocKey = documentKey(scope, event.id);
      if (eventDocKey === currentDocKey) return;
      viewCache.invalidate(eventDocKey);
      viewCache.clearScroll(eventDocKey);
    };
    return subscribeDocumentSync({ contentResolved: handler });
  }, [currentDocKey, resolveContent, scope, viewCache]);

  // Restore scroll position after document switch
  const prevScrollKeyRef = useRef(viewCache.scrollKey(currentDocKey, hasAfterMeta));
  useEffect(() => {
    const key = viewCache.scrollKey(currentDocKey, hasAfterMeta);
    if (key === prevScrollKeyRef.current) return;
    prevScrollKeyRef.current = key;

    const container = scrollRef.current;
    if (!container || !id) return;

    const saved = viewCache.getScroll(key);
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
  }, [currentDocKey, id, hasAfterMeta, viewCache]);

  const acceptRemoteContent = useCallback(async () => {
    if (!conflict) return;
    const acceptingDocId = currentDocIdRef.current;
    clearPendingSave(currentDocKey);
    try {
      const accepted = await acceptCommittedContent(
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
      viewCache.update(currentDocKey, { revision: accepted.revision, dirty: false });
      dispatchSession({ type: "clearConflict" });
      dispatchSession({ type: "syncing" });

      const transformed = transformOnLoad
        ? await transformOnLoad(accepted.content)
        : accepted.content;

      if (currentDocIdRef.current !== acceptingDocId) return;
      if (accepted.revision < baseRevisionRef.current) return;
      if (editorDirtyRef.current || hasPending()) {
        dispatchSession({
          type: "conflict",
          conflict: {
            content: accepted.content,
            revision: accepted.revision,
            updatedAt: conflict.updatedAt,
          },
        });
        return;
      }

      suppressSaveRef.current = true;
      applyContent(transformed, { addToHistory: true });
      latestContentRef.current = transformOnSave ? transformOnSave(transformed) : transformed;
      viewCache.update(currentDocKey, { content: latestContentRef.current });
      setContentVersion((value) => value + 1);
      dispatchSession({ type: "idle" });
    } catch (err) {
      console.error("[useDocumentEditor] Failed to accept remote content:", err);
      dispatchSession({ type: "syncError" });
    } finally {
      suppressSaveRef.current = false;
    }
  }, [
    applyContent,
    clearPendingSave,
    conflict,
    currentDocKey,
    dispatchSession,
    hasPending,
    scope,
    transformOnLoad,
    transformOnSave,
    viewCache,
  ]);

  const keepLocalContent = useCallback(() => {
    if (!conflict) return;
    clearPendingSave(currentDocKey);
    const pending = {
      scope,
      id: currentDocIdRef.current,
      content: latestContentRef.current,
      baseRevision: conflict.revision,
      mutationId: crypto.randomUUID(),
    };
    baseRevisionRef.current = conflict.revision;
    viewCache.update(currentDocKey, { revision: conflict.revision });
    dispatchSession({ type: "clearConflict" });
    dispatchSession({ type: "syncing" });
    void saveImmediately(pending, { immediateSync: true });
  }, [
    clearPendingSave,
    conflict,
    currentDocKey,
    dispatchSession,
    saveImmediately,
    scope,
    viewCache,
  ]);

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
    contentVersion,
    flushPendingSave,
    conflict,
    acceptRemoteContent,
    keepLocalContent,
  };
}
