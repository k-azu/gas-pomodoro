import { useCallback, useEffect, useRef, useState, type Dispatch } from "react";
import type { EditorState } from "../editor/hitomdEditor";
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
import type { DocumentSessionAction, DocumentSessionState } from "./useDocumentSession";
import type { DocumentViewCache } from "./useDocumentViewCache";

export interface DocumentEditorPort {
  captureState: () => EditorState | null;
  restoreState: (state: EditorState) => void;
  resetContent: (content: string) => void;
  applyContent: (content: string, opts?: { addToHistory?: boolean }) => void;
}

interface UseDocumentControllerOptions {
  scope: string;
  id: string;
  loadContentSnapshot: (id: string) => Promise<ContentSnapshot | null>;
  saveContent: SaveDocumentContent;
  flushSync?: (id: string) => void;
  resolveContent?: ResolveDocument;
  transformOnLoad?: (content: string) => string | Promise<string>;
  transformOnSave?: (content: string) => string;
  forceReadOnly: boolean;
  editor: DocumentEditorPort;
  session: DocumentSessionState;
  dispatchSession: Dispatch<DocumentSessionAction>;
  viewCache: DocumentViewCache;
}

/**
 * Owns document identity, persistence and synchronization.
 *
 * The editor is treated as an imperative port. This keeps tab synchronization,
 * revision tracking and conflict resolution out of the UI-facing editor hook.
 */
export function useDocumentController({
  scope,
  id,
  loadContentSnapshot,
  saveContent,
  flushSync,
  resolveContent,
  transformOnLoad,
  transformOnSave,
  forceReadOnly,
  editor,
  session,
  dispatchSession,
  viewCache,
}: UseDocumentControllerOptions) {
  const [contentVersion, setContentVersion] = useState(0);
  const suppressSaveRef = useRef(false);
  const currentDocIdRef = useRef(id);
  const currentDocKeyRef = useRef(documentKey(scope, id));
  const prevDocKeyRef = useRef<string | null>(null);
  const baseRevisionRef = useRef(0);
  const editorDirtyRef = useRef(false);
  const latestContentRef = useRef("");
  const transformErrorDocKeysRef = useRef(new Set<string>());
  const currentDocKey = documentKey(scope, id);

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

  const handleChange = useCallback(
    (markdown: string) => {
      if (suppressSaveRef.current || forceReadOnly) return;
      const docId = currentDocIdRef.current;
      const content = transformOnSave ? transformOnSave(markdown) : markdown;
      const key = documentKey(scope, docId);
      forgetFailure(key);
      transformErrorDocKeysRef.current.delete(key);
      editorDirtyRef.current = true;
      latestContentRef.current = content;
      viewCache.update(key, { content });
      dispatchSession({ type: "clearConflict" });
      queueSave({
        scope,
        id: docId,
        content,
        baseRevision: baseRevisionRef.current,
        mutationId: crypto.randomUUID(),
      });
    },
    [dispatchSession, forceReadOnly, forgetFailure, queueSave, scope, transformOnSave, viewCache],
  );

  useEffect(() => {
    if (!id) return;

    let cancelled = false;
    const key = documentKey(scope, id);
    const isSwitch = prevDocKeyRef.current !== null && prevDocKeyRef.current !== key;
    prevDocKeyRef.current = key;

    const resolveStatus = resolveContent ? getResolveStatus(scope, id) : undefined;
    if (!resolveContent || resolveStatus === "synced") {
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
      } catch (error) {
        return { content: raw, transformError: error };
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

    const restoreConflictState = (conflict?: ContentConflictSnapshot) =>
      dispatchSession({ type: "restoreConflict", conflict });

    const rememberLoadedSnapshot = (
      content: string,
      revision: number,
      dirty: boolean,
      restoredConflict?: ContentConflictSnapshot,
    ) => {
      baseRevisionRef.current = revision;
      editorDirtyRef.current = dirty;
      latestContentRef.current = transformOnSave ? transformOnSave(content) : content;
      viewCache.set(key, {
        content: latestContentRef.current,
        revision,
        dirty,
      });
      restoreConflictState(restoredConflict);
    };

    let applyingResolvedContent = false;
    let resolveCompleteReceived = false;

    const markResolveComplete = () => {
      if (cancelled) return;
      suppressSaveRef.current = false;
      dispatchSession({ type: "resolveComplete" });
      setTimeout(() => {
        if (!cancelled) dispatchSession({ type: "settleSynced" });
      }, 400);
    };

    const markResolveError = () => {
      if (cancelled) return;
      suppressSaveRef.current = false;
      dispatchSession({ type: "resolveError" });
    };

    const markLoadError = (error: unknown) => {
      console.error("[useDocumentController] Failed to load content:", error);
      if (cancelled) return;
      suppressSaveRef.current = false;
      dispatchSession({ type: "loadError" });
    };

    const markTransformError = (error: unknown) => {
      console.error("[useDocumentController] Failed to transform loaded content:", error);
      if (cancelled) return;
      transformErrorDocKeysRef.current.add(key);
      suppressSaveRef.current = false;
      dispatchSession({ type: "transformError" });
    };

    const applyLoadedSnapshot = (
      content: string,
      revision: number,
      dirty: boolean,
      restoredConflict?: ContentConflictSnapshot,
      transformError?: unknown,
    ) => {
      currentDocKeyRef.current = key;
      editor.resetContent(content);
      rememberLoadedSnapshot(content, revision, dirty, restoredConflict);
      setContentVersion((version) => version + 1);
      if (transformError) {
        markTransformError(transformError);
      } else {
        transformErrorDocKeysRef.current.delete(key);
      }
      if (!resolveContent || getResolveStatus(scope, id) === "synced") {
        suppressSaveRef.current = false;
        if (!transformError) dispatchSession({ type: "editable" });
      }
      if (resolveContent) ensureDocumentResolved(scope, id, resolveContent);
    };

    if (isSwitch) {
      const fromDocKey = currentDocKeyRef.current;
      if (fromDocKey !== key) {
        const captured = editor.captureState();
        viewCache.set(fromDocKey, {
          editorState: captured ?? undefined,
          content: latestContentRef.current,
          revision: baseRevisionRef.current,
          dirty: editorDirtyRef.current,
        });
      }

      const hasCachedEditor = Boolean(viewCache.get(key)?.editorState);
      const needsResolve = Boolean(resolveContent && !getResolveStatus(scope, id));

      if (hasCachedEditor && !needsResolve) {
        currentDocIdRef.current = id;
        currentDocKeyRef.current = key;
        if (!resolveContent || getResolveStatus(scope, id) === "synced") {
          suppressSaveRef.current = false;
        }
        const cached = viewCache.get(key);
        if (cached?.editorState) {
          editor.restoreState(cached.editorState);
          latestContentRef.current = cached.content;
          baseRevisionRef.current = cached.revision;
          editorDirtyRef.current = cached.dirty;
          restoreConflictState();
          setContentVersion((version) => version + 1);
        }

        void loadContentSnapshot(id)
          .then((snapshot) => {
            if (!cancelled && snapshot?.conflict) restoreConflictState(snapshot.conflict);
          })
          .catch((error) => {
            console.warn("[useDocumentController] Failed to restore persisted conflict:", error);
          });

        if (resolveContent) ensureDocumentResolved(scope, id, resolveContent);
      } else {
        if (hasCachedEditor) viewCache.invalidate(key);
        dispatchSession({ type: "loading" });
        currentDocIdRef.current = id;
        currentDocKeyRef.current = key;
        suppressSaveRef.current = true;

        void load(id)
          .then(({ content, revision, dirty, conflict, transformError }) => {
            if (cancelled) {
              suppressSaveRef.current = false;
              return;
            }
            applyLoadedSnapshot(content, revision, dirty, conflict, transformError);
          })
          .catch(markLoadError);
      }
    } else {
      if (resolveContent && resolveStatus !== "synced") suppressSaveRef.current = true;
      void load(id)
        .then(({ content, revision, dirty, conflict, transformError }) => {
          if (cancelled) {
            suppressSaveRef.current = false;
            return;
          }
          currentDocIdRef.current = id;
          currentDocKeyRef.current = key;
          applyLoadedSnapshot(content, revision, dirty, conflict, transformError);
        })
        .catch(markLoadError);
    }

    const onContentResolved = async (event: {
      storeName?: string;
      id: string;
      content: string;
      revision?: number;
    }) => {
      if (event.storeName !== scope || event.id !== id || cancelled) return;
      applyingResolvedContent = true;
      try {
        const transformed = await transformLoadedContent(event.content);
        if (cancelled) return;
        suppressSaveRef.current = true;
        editor.applyContent(transformed.content, { addToHistory: true });
        const revision = Math.max(1, event.revision || 1);
        baseRevisionRef.current = revision;
        editorDirtyRef.current = false;
        latestContentRef.current = transformOnSave
          ? transformOnSave(transformed.content)
          : transformed.content;
        viewCache.update(key, {
          content: latestContentRef.current,
          revision,
          dirty: false,
        });
        setContentVersion((version) => version + 1);
        applyingResolvedContent = false;
        if (transformed.transformError) {
          invalidateResolveStatus(scope, id);
          markTransformError(transformed.transformError);
          return;
        }
        transformErrorDocKeysRef.current.delete(key);
        if (resolveCompleteReceived) markResolveComplete();
      } catch (error) {
        console.error("[useDocumentController] Failed to apply resolved content:", error);
        applyingResolvedContent = false;
        invalidateResolveStatus(scope, id);
        markResolveError();
      }
    };

    const onResolveComplete = (event: { scope?: string; id: string; revision?: number }) => {
      if (event.scope !== scope || event.id !== id || cancelled) return;
      if (transformErrorDocKeysRef.current.has(key)) return;
      if (applyingResolvedContent) {
        resolveCompleteReceived = true;
        return;
      }
      if (!editorDirtyRef.current && event.revision) {
        baseRevisionRef.current = event.revision;
        viewCache.update(key, { revision: event.revision });
      }
      markResolveComplete();
    };

    const onResolveError = (event: { scope?: string; id: string }) => {
      if (event.scope === scope && event.id === id && !cancelled) markResolveError();
    };

    const applyRemoteSnapshot = async (content: string, revision: number, updatedAt: string) => {
      if (cancelled || revision <= baseRevisionRef.current) return;
      if (editorDirtyRef.current || hasPending()) {
        dispatchSession({ type: "conflict", conflict: { content, revision, updatedAt } });
        return;
      }
      const transformed = await transformLoadedContent(content);
      if (cancelled || revision <= baseRevisionRef.current) return;
      if (editorDirtyRef.current || hasPending()) {
        dispatchSession({ type: "conflict", conflict: { content, revision, updatedAt } });
        return;
      }
      if (transformed.transformError) {
        markTransformError(transformed.transformError);
        return;
      }
      suppressSaveRef.current = true;
      editor.applyContent(transformed.content, { addToHistory: true });
      baseRevisionRef.current = revision;
      editorDirtyRef.current = false;
      latestContentRef.current = transformOnSave
        ? transformOnSave(transformed.content)
        : transformed.content;
      viewCache.update(key, {
        content: latestContentRef.current,
        revision,
        dirty: false,
      });
      setContentVersion((version) => version + 1);
      dispatchSession({ type: "synced" });
      setTimeout(() => {
        if (!cancelled) dispatchSession({ type: "settleSynced" });
      }, 400);
      suppressSaveRef.current = false;
    };

    const onContentCommitted = (event: {
      storeName: string;
      id: string;
      content: string;
      revision: number;
    }) => {
      if (event.storeName !== scope || event.id !== id || cancelled) return;
      baseRevisionRef.current = event.revision;
      viewCache.update(key, { revision: event.revision });
      advancePendingRevision(event.revision);
      if (event.content === latestContentRef.current && !hasPending()) {
        editorDirtyRef.current = false;
        viewCache.update(key, { dirty: false });
        dispatchSession({ type: "synced" });
        setTimeout(() => {
          if (!cancelled) dispatchSession({ type: "settleSynced" });
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
      if (event.storeName !== scope || event.id !== id || cancelled) return;
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
      if (message.storeName !== scope || message.id !== id || cancelled) return;
      void getCommittedContentSnapshot(scope, id).then((snapshot) => {
        if (!snapshot || snapshot.revision < message.revision) return;
        return applyRemoteSnapshot(snapshot.content, snapshot.revision, message.updatedAt);
      });
    };

    const checkForMissedCommit = () => {
      if (document.visibilityState === "hidden") return;
      void getCommittedContentSnapshot(scope, id).then((snapshot) => {
        if (snapshot) return applyRemoteSnapshot(snapshot.content, snapshot.revision, "");
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
      cancelled = true;
      unsubscribeSync();
      window.removeEventListener("focus", checkForMissedCommit);
      document.removeEventListener("visibilitychange", checkForMissedCommit);
      flushPendingSave();
    };
  }, [
    advancePendingRevision,
    dispatchSession,
    editor,
    flushPendingSave,
    hasPending,
    id,
    loadContentSnapshot,
    resolveContent,
    scope,
    transformOnLoad,
    transformOnSave,
    viewCache,
  ]);

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
      if (eventDocKey !== currentDocKey) viewCache.invalidate(eventDocKey);
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

  useEffect(() => {
    if (!resolveContent) return;
    return subscribeDocumentSync({
      contentResolved: (event) => {
        if (event.storeName !== scope) return;
        const eventDocKey = documentKey(scope, event.id);
        if (eventDocKey === currentDocKey) return;
        viewCache.invalidate(eventDocKey);
        viewCache.clearScroll(eventDocKey);
      },
    });
  }, [currentDocKey, resolveContent, scope, viewCache]);

  const acceptRemoteContent = useCallback(async () => {
    const conflict = session.conflict;
    if (!conflict) return;
    const acceptingDocId = currentDocIdRef.current;
    clearPendingSave(currentDocKey);
    try {
      const accepted = await acceptCommittedContent(
        scope,
        acceptingDocId,
        conflict.content,
        conflict.revision,
        conflict.updatedAt,
      );
      if (!accepted || currentDocIdRef.current !== acceptingDocId) return;

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
      editor.applyContent(transformed, { addToHistory: true });
      latestContentRef.current = transformOnSave ? transformOnSave(transformed) : transformed;
      viewCache.update(currentDocKey, { content: latestContentRef.current });
      setContentVersion((version) => version + 1);
      dispatchSession({ type: "idle" });
    } catch (error) {
      console.error("[useDocumentController] Failed to accept remote content:", error);
      dispatchSession({ type: "syncError" });
    } finally {
      suppressSaveRef.current = false;
    }
  }, [
    clearPendingSave,
    currentDocKey,
    dispatchSession,
    editor,
    hasPending,
    scope,
    session.conflict,
    transformOnLoad,
    transformOnSave,
    viewCache,
  ]);

  const keepLocalContent = useCallback(() => {
    const conflict = session.conflict;
    if (!conflict) return;
    clearPendingSave(currentDocKey);
    baseRevisionRef.current = conflict.revision;
    viewCache.update(currentDocKey, { revision: conflict.revision });
    dispatchSession({ type: "clearConflict" });
    dispatchSession({ type: "syncing" });
    void saveImmediately(
      {
        scope,
        id: currentDocIdRef.current,
        content: latestContentRef.current,
        baseRevision: conflict.revision,
        mutationId: crypto.randomUUID(),
      },
      { immediateSync: true },
    );
  }, [
    clearPendingSave,
    currentDocKey,
    dispatchSession,
    saveImmediately,
    scope,
    session.conflict,
    viewCache,
  ]);

  return {
    handleChange,
    contentVersion,
    flushPendingSave,
    acceptRemoteContent,
    keepLocalContent,
  };
}
