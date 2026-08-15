import { useCallback, useEffect, useRef, useState } from "react";
import type { MentionTrigger } from "../editor/hitomdEditor";
import type { SyncStatus } from "../components/shared/SyncIndicator";
import { registerDocumentEditGuard, type DocumentEditorKey } from "../lib/documentNavigationGuard";
import * as DocumentStore from "../lib/documentStore";
import { DocumentContentConflictError, type ContentSnapshot } from "../lib/documentStore";
import { useMarkdownEditor } from "./useMarkdownEditor";

interface UseDocumentEditorOptions {
  editorKey: DocumentEditorKey;
  scope: string;
  id: string;
  loadContent: (id: string) => Promise<string | null>;
  saveContent: (id: string, content: string, opts?: { immediateSync?: boolean }) => Promise<void>;
  flushSync?: (id: string) => void;
  resolveContent?: (id: string) => Promise<{ useServer: boolean; content?: string } | null>;
  transformOnLoad?: (content: string) => string | Promise<string>;
  transformOnSave?: (content: string) => string;
  onImageUpload?: (file: File) => Promise<string>;
  onResolveLink?: (url: string) => Promise<{ title?: string }>;
  mentions?: MentionTrigger[];
  forceReadOnly?: boolean;
  hasAfterMeta?: boolean;
}

const SAVE_IDLE_MS = 15_000;
const EDIT_LEASE_HANDOFF_TIMEOUT_MS = 30_000;
const editLeaseSource = crypto.randomUUID();
const editLeaseChannel =
  typeof window === "undefined" || typeof BroadcastChannel === "undefined"
    ? null
    : new BroadcastChannel("gas-pomodoro:document-edit-lease:v1");

export function useDocumentEditor({
  editorKey,
  scope,
  id,
  loadContent,
  saveContent,
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
  const [savingForTransition, setSavingForTransition] = useState(false);
  const [contentReady, setContentReady] = useState(false);
  const [contentRevision, setContentRevision] = useState(0);
  const lockSupported = typeof navigator !== "undefined" && "locks" in navigator;
  const [ownsEditLock, setOwnsEditLock] = useState(!lockSupported);
  const [contentConflict, setContentConflict] = useState<{
    localContent: string;
    remote: ContentSnapshot;
  } | null>(null);
  const suppressSaveRef = useRef(false);
  const frozenForTransitionRef = useRef(false);
  const currentIdRef = useRef(id);
  const currentScopeRef = useRef(scope);
  const dirtyRef = useRef(false);
  const editVersionRef = useRef(0);
  const pendingContentRef = useRef<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef<Promise<void> | null>(null);
  const conflictRef = useRef<{ localContent: string; remote: ContentSnapshot } | null>(null);
  const saveContentRef = useRef(saveContent);
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollPositionsRef = useRef(new Map<string, number>());
  const releaseEditLockRef = useRef<(() => void) | null>(null);
  const [editLeaseReleased, setEditLeaseReleased] = useState(false);
  const editLeaseReleasedRef = useRef(false);
  const handoffRecoveryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearHandoffRecoveryTimer = useCallback(() => {
    if (handoffRecoveryTimerRef.current) {
      clearTimeout(handoffRecoveryTimerRef.current);
      handoffRecoveryTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    saveContentRef.current = saveContent;
  }, [saveContent]);

  const saveLatest = useCallback(async (): Promise<void> => {
    if (conflictRef.current) throw new Error("Resolve the document conflict before leaving");
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    while (dirtyRef.current) {
      if (inFlightRef.current) {
        await inFlightRef.current;
        continue;
      }
      const content = pendingContentRef.current;
      if (content === null) return;
      const documentId = currentIdRef.current;
      const version = editVersionRef.current;
      setSyncStatus("syncing");
      const request = saveContentRef.current(documentId, content, { immediateSync: true });
      inFlightRef.current = request;
      try {
        await request;
        if (editVersionRef.current === version && currentIdRef.current === documentId) {
          dirtyRef.current = false;
          pendingContentRef.current = null;
          setSyncStatus("synced");
          window.setTimeout(
            () => setSyncStatus((value) => (value === "synced" ? "idle" : value)),
            400,
          );
        }
      } catch (error) {
        if (error instanceof DocumentContentConflictError) {
          const conflict = { localContent: error.localContent, remote: error.remote };
          conflictRef.current = conflict;
          setContentConflict(conflict);
        }
        setSyncStatus("error");
        throw error;
      } finally {
        if (inFlightRef.current === request) inFlightRef.current = null;
      }
    }
  }, []);

  const runWhileFrozen = useCallback(
    async <T>(operation: () => Promise<T>): Promise<T> => {
      frozenForTransitionRef.current = true;
      setSavingForTransition(true);
      try {
        await saveLatest();
        await DocumentStore.waitForAllMetadata();
        return await operation();
      } finally {
        frozenForTransitionRef.current = false;
        setSavingForTransition(false);
      }
    },
    [saveLatest],
  );

  const saveForTransition = useCallback(
    () => runWhileFrozen(async () => undefined),
    [runWhileFrozen],
  );

  const handleChange = useCallback(
    (markdown: string) => {
      if (suppressSaveRef.current || forceReadOnly || frozenForTransitionRef.current) return;
      const content = transformOnSave ? transformOnSave(markdown) : markdown;
      dirtyRef.current = true;
      editVersionRef.current += 1;
      pendingContentRef.current = content;
      setSyncStatus("idle");
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        saveTimerRef.current = null;
        void saveLatest().catch((error) => {
          console.error("[useDocumentEditor] Failed to save content", error);
        });
      }, SAVE_IDLE_MS);
    },
    [forceReadOnly, saveLatest, transformOnSave],
  );

  const { editor, mode, setMode, rawMarkdown, setRawMarkdown, resetContent } = useMarkdownEditor({
    initialContent: "",
    onChange: handleChange,
    onCharCount: setCharCount,
    readOnly:
      forceReadOnly ||
      !contentReady ||
      savingForTransition ||
      contentConflict !== null ||
      (lockSupported && !ownsEditLock),
    onImageUpload,
    onResolveLink,
    mentions,
  });

  const flushPendingSave = useCallback(
    () =>
      saveForTransition()
        .then(() => true)
        .catch(() => false),
    [saveForTransition],
  );

  useEffect(() => {
    if (!id) return;
    return registerDocumentEditGuard(editorKey, {
      documentKey: `${scope}:${id}`,
      isDirty: () => dirtyRef.current || inFlightRef.current !== null,
      saveBeforeTransition: saveForTransition,
      runWhileFrozen,
    });
  }, [editorKey, id, runWhileFrozen, saveForTransition, scope]);

  useEffect(() => {
    releaseEditLockRef.current?.();
    releaseEditLockRef.current = null;
    if (!lockSupported) {
      setOwnsEditLock(true);
      return;
    }
    if (!id || forceReadOnly || editLeaseReleased) {
      setOwnsEditLock(false);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    setOwnsEditLock(false);
    void navigator.locks
      .request(
        `gas-pomodoro:document-edit:${scope}:${id}`,
        { mode: "exclusive", signal: controller.signal },
        async (lock) => {
          if (!lock || cancelled) return;
          setOwnsEditLock(true);
          editLeaseChannel?.postMessage({
            type: "lease-acquired",
            source: editLeaseSource,
            documentKey: `${scope}:${id}`,
          });
          await new Promise<void>((resolve) => {
            releaseEditLockRef.current = resolve;
          });
          releaseEditLockRef.current = null;
          setOwnsEditLock(false);
        },
      )
      .catch((lockError) => {
        if (!(lockError instanceof DOMException && lockError.name === "AbortError")) {
          console.error("[useDocumentEditor] Failed to acquire edit lock", lockError);
        }
      });
    return () => {
      cancelled = true;
      controller.abort();
      releaseEditLockRef.current?.();
      releaseEditLockRef.current = null;
    };
  }, [editLeaseReleased, forceReadOnly, id, lockSupported, scope]);

  useEffect(() => {
    if (!editLeaseChannel || !id) return;
    const handleLeaseMessage = (event: MessageEvent) => {
      const message = event.data as {
        type?: string;
        source?: string;
        documentKey?: string;
      } | null;
      if (
        !message ||
        message.type !== "lease-acquired" ||
        message.source === editLeaseSource ||
        message.documentKey !== `${scope}:${id}` ||
        !editLeaseReleasedRef.current
      ) {
        return;
      }
      clearHandoffRecoveryTimer();
      editLeaseReleasedRef.current = false;
      setEditLeaseReleased(false);
    };
    editLeaseChannel.addEventListener("message", handleLeaseMessage);
    return () => editLeaseChannel.removeEventListener("message", handleLeaseMessage);
  }, [clearHandoffRecoveryTimer, id, scope]);

  useEffect(() => clearHandoffRecoveryTimer, [clearHandoffRecoveryTimer]);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current && !inFlightRef.current) {
        return;
      }
      event.preventDefault();
      event.returnValue = "";
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState !== "hidden" || !dirtyRef.current) {
        return;
      }
      void saveLatest().catch((error) => {
        console.error("[useDocumentEditor] Hidden-page save failed", error);
      });
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [saveLatest]);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    const previousKey = `${currentScopeRef.current}:${currentIdRef.current}`;
    const nextKey = `${scope}:${id}`;
    if (previousKey !== nextKey) {
      scrollPositionsRef.current.set(previousKey, scrollRef.current?.scrollTop ?? 0);
    }
    currentIdRef.current = id;
    currentScopeRef.current = scope;
    clearHandoffRecoveryTimer();
    editLeaseReleasedRef.current = false;
    setEditLeaseReleased(false);
    dirtyRef.current = false;
    pendingContentRef.current = null;
    editVersionRef.current = 0;
    conflictRef.current = null;
    setContentConflict(null);
    setContentReady(false);
    suppressSaveRef.current = true;
    setSyncStatus("syncing");
    setMode("wysiwyg");

    loadContent(id)
      .then(async (raw) => (transformOnLoad ? transformOnLoad(raw ?? "") : (raw ?? "")))
      .then((content) => {
        if (cancelled) return;
        resetContent(content);
        setContentRevision((revision) => revision + 1);
        suppressSaveRef.current = false;
        setContentReady(true);
        setSyncStatus("idle");
        const scrollTop = scrollPositionsRef.current.get(nextKey) ?? 0;
        if (scrollRef.current) scrollRef.current.scrollTop = scrollTop;
      })
      .catch((error) => {
        console.error("[useDocumentEditor] Failed to load content", error);
        if (cancelled) return;
        setSyncStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [clearHandoffRecoveryTimer, id, loadContent, resetContent, scope, setMode, transformOnLoad]);

  const keepLocalConflict = useCallback(async (): Promise<void> => {
    const conflict = conflictRef.current;
    if (!conflict) return;
    DocumentStore.applyContentSnapshot(
      currentScopeRef.current as DocumentStore.DocumentStoreName,
      currentIdRef.current,
      conflict.remote,
    );
    conflictRef.current = null;
    setContentConflict(null);
    pendingContentRef.current = conflict.localContent;
    editVersionRef.current += 1;
    dirtyRef.current = true;
    await saveForTransition();
  }, [saveForTransition]);

  const acceptRemoteConflict = useCallback(async (): Promise<void> => {
    const conflict = conflictRef.current;
    if (!conflict) return;
    DocumentStore.applyContentSnapshot(
      currentScopeRef.current as DocumentStore.DocumentStoreName,
      currentIdRef.current,
      conflict.remote,
    );
    const content = transformOnLoad
      ? await transformOnLoad(conflict.remote.content)
      : conflict.remote.content;
    suppressSaveRef.current = true;
    resetContent(content);
    dirtyRef.current = false;
    pendingContentRef.current = null;
    conflictRef.current = null;
    setContentConflict(null);
    setSyncStatus("idle");
    suppressSaveRef.current = false;
    setContentRevision((revision) => revision + 1);
  }, [resetContent, transformOnLoad]);

  const handoffEditLease = useCallback(async (): Promise<boolean> => {
    if (!lockSupported || !ownsEditLock) return false;
    try {
      await saveForTransition();
      editLeaseReleasedRef.current = true;
      setEditLeaseReleased(true);
      releaseEditLockRef.current?.();
      releaseEditLockRef.current = null;
      setOwnsEditLock(false);
      clearHandoffRecoveryTimer();
      handoffRecoveryTimerRef.current = setTimeout(() => {
        handoffRecoveryTimerRef.current = null;
        if (!editLeaseReleasedRef.current) return;
        editLeaseReleasedRef.current = false;
        setEditLeaseReleased(false);
      }, EDIT_LEASE_HANDOFF_TIMEOUT_MS);
      return true;
    } catch {
      return false;
    }
  }, [clearHandoffRecoveryTimer, lockSupported, ownsEditLock, saveForTransition]);

  useEffect(() => {
    if (!id) return;
    const handleStoreChange = (event: { op: string }) => {
      if (event.op === "serverRefresh" && !dirtyRef.current) {
        suppressSaveRef.current = true;
        setContentReady(false);
        setSyncStatus("syncing");
        void loadContent(id)
          .then(async (raw) => (transformOnLoad ? transformOnLoad(raw ?? "") : (raw ?? "")))
          .then((content) => {
            if (dirtyRef.current) return;
            resetContent(content);
            setContentRevision((revision) => revision + 1);
            suppressSaveRef.current = false;
            setContentReady(true);
            setSyncStatus("idle");
          })
          .catch((refreshError) => {
            suppressSaveRef.current = false;
            setSyncStatus("error");
            console.error("[useDocumentEditor] Failed to apply refreshed content", refreshError);
          });
      }
    };
    DocumentStore.on(handleStoreChange);
    return () => DocumentStore.off(handleStoreChange);
  }, [id, loadContent, resetContent, transformOnLoad]);

  return {
    editor,
    mode,
    setMode,
    rawMarkdown,
    setRawMarkdown,
    charCount,
    scrollRef,
    readOnly:
      forceReadOnly ||
      !contentReady ||
      savingForTransition ||
      contentConflict !== null ||
      (lockSupported && !ownsEditLock),
    syncStatus:
      lockSupported && !ownsEditLock && !forceReadOnly && contentReady
        ? ("locked" as const)
        : syncStatus,
    contentRevision,
    contentConflict: contentConflict
      ? {
          localContent: contentConflict.localContent,
          remoteContent: contentConflict.remote.content,
          remoteRevision: contentConflict.remote.revision,
        }
      : null,
    keepLocalConflict,
    acceptRemoteConflict,
    handoffEditLease,
    canOpenInNewTab: lockSupported && ownsEditLock && !forceReadOnly && contentReady,
    flushPendingSave,
    savingForTransition,
  };
}
