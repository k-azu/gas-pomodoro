import { useCallback, useEffect, useRef, useState, type Dispatch } from "react";
import type { EditorState } from "../editor/hitomdEditor";
import { refreshDocumentContent, subscribeDocumentContent } from "../lib/documentContentStore";
import type { DocumentContentReadModel } from "../lib/documentContentModel";
import { DocumentOperationGuard } from "../lib/documentOperationGuard";
import { getDocumentConflict } from "../lib/documentSessionModel";
import {
  acceptCommittedContent,
  documentKey,
  ensureDocumentResolved,
  getResolveStatus,
  type ContentConflictSnapshot,
  type ResolveDocument,
} from "../lib/documentSync";
import { getDocumentSyncError, subscribeDocumentSyncError } from "../lib/documentSyncErrors";
import {
  useDocumentSaveQueue,
  type PendingDocumentSave,
  type SaveDocumentContent,
} from "./useDocumentSaveQueue";
import type { DocumentSessionEvent, DocumentSessionState } from "./useDocumentSession";
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
  saveContent: SaveDocumentContent;
  flushSync?: (id: string) => void;
  resolveContent?: ResolveDocument;
  transformOnLoad?: (content: string) => string | Promise<string>;
  transformOnSave?: (content: string) => string;
  forceReadOnly: boolean;
  ownsEditLease: boolean;
  editor: DocumentEditorPort;
  session: DocumentSessionState;
  dispatchSession: Dispatch<DocumentSessionEvent>;
  viewCache: DocumentViewCache;
}

/**
 * Connects the editor to the canonical DocumentContentStore.
 *
 * Persisted Draft state is document-global. Only input that has not reached
 * IndexedDB yet is considered local to this tab and protected from snapshots.
 */
export function useDocumentController({
  scope,
  id,
  saveContent,
  flushSync,
  resolveContent,
  transformOnLoad,
  transformOnSave,
  forceReadOnly,
  ownsEditLease,
  editor,
  session,
  dispatchSession,
  viewCache,
}: UseDocumentControllerOptions) {
  const [contentVersion, setContentVersion] = useState(0);
  const suppressSaveRef = useRef(false);
  const currentDocIdRef = useRef(id);
  const baseRevisionRef = useRef(0);
  const latestContentRef = useRef("");
  const operationGuardRef = useRef(new DocumentOperationGuard());
  const ownsEditLeaseRef = useRef(ownsEditLease);
  const refreshCurrentRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const loadedDocKeysRef = useRef(new Set<string>());
  ownsEditLeaseRef.current = ownsEditLease;

  const currentDocKey = documentKey(scope, id);
  const conflict = getDocumentConflict(session);
  const conflictResolutionInProgress =
    session.sync.kind === "conflict" && Boolean(session.sync.resolution);

  const reportSaveStart = useCallback(
    (pending: PendingDocumentSave) => {
      if (pending.scope === scope && pending.id === currentDocIdRef.current) {
        dispatchSession({ type: "saveStarted" });
      }
    },
    [dispatchSession, scope],
  );

  const reportSaveError = useCallback(
    (pending: PendingDocumentSave) => {
      if (pending.scope === scope && pending.id === currentDocIdRef.current) {
        dispatchSession({ type: "operationFailed", reason: "save", hasLocalChanges: true });
      }
    },
    [dispatchSession, scope],
  );

  const {
    queueSave,
    saveImmediately,
    flushPendingSave,
    clear: clearPendingSave,
    forgetFailure,
    waitForInFlight,
    hasUnpersisted,
  } = useDocumentSaveQueue({
    currentDocIdRef,
    saveContent,
    flushSync,
    onStart: reportSaveStart,
    onError: reportSaveError,
  });

  const handleChange = useCallback(
    (markdown: string) => {
      if (suppressSaveRef.current || forceReadOnly || !ownsEditLeaseRef.current) return;
      const docId = currentDocIdRef.current;
      const key = documentKey(scope, docId);
      const content = transformOnSave ? transformOnSave(markdown) : markdown;
      forgetFailure(key);
      latestContentRef.current = content;
      viewCache.update(key, { content });
      dispatchSession({ type: "localEdited" });
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

    const key = documentKey(scope, id);
    const operation = operationGuardRef.current.start(key);
    const isCurrent = () => operationGuardRef.current.isCurrent(operation);
    const cached = viewCache.get(key);
    let firstSnapshot = true;
    let lastAppliedVersionToken: string | undefined;
    let applyChain = Promise.resolve();

    currentDocIdRef.current = id;
    suppressSaveRef.current = true;

    const needsResolve = Boolean(resolveContent && getResolveStatus(scope, id) !== "synced");
    dispatchSession({ type: "documentOpened", needsResolve });

    const markLoadError = (error: unknown) => {
      console.error("[useDocumentController] Failed to load content:", error);
      if (!isCurrent()) return;
      suppressSaveRef.current = false;
      dispatchSession({ type: "operationFailed", reason: "load", hasLocalChanges: false });
    };

    const markResolveError = (error: unknown) => {
      console.error("[useDocumentController] Failed to resolve content:", error);
      if (!isCurrent()) return;
      suppressSaveRef.current = false;
      dispatchSession({
        type: "operationFailed",
        reason: "resolve",
        hasLocalChanges: hasUnpersisted(key),
      });
    };

    const applySnapshot = async (snapshot: DocumentContentReadModel | null) => {
      if (!isCurrent() || !snapshot || snapshot.versionToken === lastAppliedVersionToken) return;

      let displayContent = snapshot.content;
      let transformError: unknown;
      if (transformOnLoad) {
        try {
          displayContent = await transformOnLoad(snapshot.content);
        } catch (error) {
          transformError = error;
        }
      }
      if (!isCurrent()) return;

      const persistedContent = transformOnSave ? transformOnSave(displayContent) : displayContent;
      const hasLocalInput = ownsEditLeaseRef.current && hasUnpersisted(key);

      if (hasLocalInput && persistedContent !== latestContentRef.current) {
        if (snapshot.conflict) {
          dispatchSession({ type: "remoteConflictDetected", remote: snapshot.conflict });
        }
        return;
      }

      suppressSaveRef.current = true;
      const restoreCachedEditor = Boolean(
        firstSnapshot &&
        cached?.editorState &&
        !transformError &&
        cached.content === persistedContent,
      );
      const contentChanged = persistedContent !== latestContentRef.current;

      if (restoreCachedEditor && cached?.editorState) {
        editor.restoreState(cached.editorState);
      } else if (firstSnapshot) {
        editor.resetContent(displayContent);
      } else if (contentChanged) {
        editor.applyContent(displayContent, { addToHistory: true });
      }

      baseRevisionRef.current = snapshot.revision;
      latestContentRef.current = persistedContent;
      lastAppliedVersionToken = snapshot.versionToken;
      firstSnapshot = false;
      viewCache.set(key, {
        ...(restoreCachedEditor && cached?.editorState ? { editorState: cached.editorState } : {}),
        content: persistedContent,
      });
      dispatchSession({
        type: "localSnapshotLoaded",
        dirty: ownsEditLeaseRef.current && snapshot.source === "draft",
        ...(snapshot.conflict ? { conflict: snapshot.conflict } : {}),
      });
      if (getDocumentSyncError(scope, id) !== undefined) {
        dispatchSession({ type: "operationFailed", reason: "save", hasLocalChanges: true });
      }
      if (contentChanged || restoreCachedEditor) {
        setContentVersion((version) => version + 1);
      }

      if (transformError) {
        console.error(
          "[useDocumentController] Failed to transform loaded content:",
          transformError,
        );
        dispatchSession({
          type: "operationFailed",
          reason: "transform",
          hasLocalChanges: hasUnpersisted(key),
        });
      }
      if (!resolveContent || getResolveStatus(scope, id) === "synced") {
        suppressSaveRef.current = false;
      }
    };

    const enqueueSnapshot = (snapshot: DocumentContentReadModel | null) => {
      applyChain = applyChain.then(() => applySnapshot(snapshot)).catch(markLoadError);
      return applyChain;
    };

    const refresh = async () => {
      const snapshot = await refreshDocumentContent(scope, id);
      await enqueueSnapshot(snapshot);
    };
    refreshCurrentRef.current = refresh;

    const unsubscribeContent = subscribeDocumentContent(scope, id, (snapshot) => {
      void enqueueSnapshot(snapshot);
    });
    const unsubscribeSyncError = subscribeDocumentSyncError((event) => {
      if (event.storeName !== scope || event.id !== id || !isCurrent()) return;
      dispatchSession({ type: "operationFailed", reason: "save", hasLocalChanges: true });
    });

    const refreshOnFocus = () => {
      if (document.visibilityState !== "hidden") void refresh().catch(markLoadError);
    };
    window.addEventListener("focus", refreshOnFocus);
    document.addEventListener("visibilitychange", refreshOnFocus);

    void (async () => {
      try {
        await refresh();
        loadedDocKeysRef.current.add(key);
      } catch (error) {
        markLoadError(error);
        return;
      }

      if (!resolveContent || !needsResolve) {
        suppressSaveRef.current = false;
        return;
      }
      try {
        await ensureDocumentResolved(scope, id, resolveContent);
        await refresh();
        if (!isCurrent()) return;
        suppressSaveRef.current = false;
        dispatchSession({ type: "resolveSucceeded" });
      } catch (error) {
        markResolveError(error);
      }
    })();

    return () => {
      const captured = editor.captureState();
      viewCache.set(key, {
        editorState: captured ?? undefined,
        content: latestContentRef.current,
      });
      operationGuardRef.current.finish(operation);
      unsubscribeContent();
      unsubscribeSyncError();
      window.removeEventListener("focus", refreshOnFocus);
      document.removeEventListener("visibilitychange", refreshOnFocus);
    };
  }, [
    dispatchSession,
    editor,
    hasUnpersisted,
    id,
    resolveContent,
    scope,
    transformOnLoad,
    transformOnSave,
    viewCache,
  ]);

  const acceptRemoteContent = useCallback(async () => {
    if (!conflict || conflictResolutionInProgress) return;
    const operation = operationGuardRef.current.capture(currentDocKey);
    if (!operation) return;
    suppressSaveRef.current = true;
    clearPendingSave(currentDocKey);
    dispatchSession({ type: "conflictResolutionStarted", choice: "remote" });
    try {
      await waitForInFlight(currentDocKey);
      clearPendingSave(currentDocKey);
      if (!operationGuardRef.current.isCurrent(operation)) return;
      const accepted = await acceptCommittedContent(
        scope,
        currentDocIdRef.current,
        conflict.content,
        conflict.revision,
        conflict.updatedAt,
      );
      if (!operationGuardRef.current.isCurrent(operation)) return;
      if (!accepted) {
        suppressSaveRef.current = false;
        dispatchSession({ type: "operationFailed", reason: "save", hasLocalChanges: true });
        return;
      }
      if (accepted.conflict) {
        suppressSaveRef.current = false;
        dispatchSession({ type: "remoteConflictDetected", remote: accepted.conflict });
        return;
      }
      await refreshCurrentRef.current();
    } catch (error) {
      if (!operationGuardRef.current.isCurrent(operation)) return;
      console.error("[useDocumentController] Failed to accept remote content:", error);
      suppressSaveRef.current = false;
      dispatchSession({ type: "operationFailed", reason: "save", hasLocalChanges: true });
    }
  }, [
    clearPendingSave,
    conflict,
    conflictResolutionInProgress,
    currentDocKey,
    dispatchSession,
    scope,
    waitForInFlight,
  ]);

  const keepLocalContent = useCallback(() => {
    if (!conflict || conflictResolutionInProgress) return;
    const operation = operationGuardRef.current.capture(currentDocKey);
    if (!operation) return;
    const content = latestContentRef.current;
    suppressSaveRef.current = true;
    clearPendingSave(currentDocKey);
    dispatchSession({ type: "conflictResolutionStarted", choice: "local" });
    void (async () => {
      await waitForInFlight(currentDocKey);
      clearPendingSave(currentDocKey);
      if (!operationGuardRef.current.isCurrent(operation)) return;
      await saveImmediately(
        {
          scope,
          id: currentDocIdRef.current,
          content,
          baseRevision: conflict.revision,
          mutationId: crypto.randomUUID(),
        },
        { immediateSync: true, resolveConflict: true },
      );
    })().catch(() => {
      if (operationGuardRef.current.isCurrent(operation)) suppressSaveRef.current = false;
    });
  }, [
    clearPendingSave,
    conflict,
    conflictResolutionInProgress,
    currentDocKey,
    dispatchSession,
    saveImmediately,
    scope,
    waitForInFlight,
  ]);

  const prepareForEditing = useCallback(async () => {
    const key = documentKey(scope, id);
    if (loadedDocKeysRef.current.has(key)) {
      await refreshDocumentContent(scope, id);
    }
    flushSync?.(id);
  }, [flushSync, id, scope]);

  return {
    handleChange,
    contentVersion,
    flushPendingSave,
    prepareForEditing,
    acceptRemoteContent,
    keepLocalContent,
  };
}
