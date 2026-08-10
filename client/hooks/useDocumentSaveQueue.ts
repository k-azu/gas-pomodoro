import { useCallback, useEffect, useRef, type RefObject } from "react";
import type { ContentSaveOptions } from "../lib/documentSync";
import { documentKey } from "../lib/documentSync";

export type SaveDocumentContent = (
  id: string,
  content: string,
  opts?: ContentSaveOptions,
) => Promise<void>;

export interface PendingDocumentSave {
  scope: string;
  id: string;
  content: string;
  baseRevision: number;
  mutationId: string;
  saveContent: SaveDocumentContent;
}

interface UseDocumentSaveQueueOptions {
  currentDocIdRef: RefObject<string>;
  saveContent: SaveDocumentContent;
  flushSync?: (id: string) => void;
  onError: () => void;
}

export function useDocumentSaveQueue({
  currentDocIdRef,
  saveContent,
  flushSync,
  onError,
}: UseDocumentSaveQueueOptions) {
  const saveContentRef = useRef(saveContent);
  const flushSyncRef = useRef(flushSync);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<PendingDocumentSave | null>(null);
  const failedRef = useRef(new Map<string, PendingDocumentSave>());
  const savingSeqRef = useRef(0);

  useEffect(() => {
    saveContentRef.current = saveContent;
    flushSyncRef.current = flushSync;
  }, [saveContent, flushSync]);

  const saveNow = useCallback(
    (pending: PendingDocumentSave, opts?: ContentSaveOptions) => {
      const saveSeq = ++savingSeqRef.current;
      const key = documentKey(pending.scope, pending.id);
      return pending
        .saveContent(pending.id, pending.content, {
          ...opts,
          baseRevision: pending.baseRevision,
          mutationId: pending.mutationId,
        })
        .catch((error) => {
          console.error("[useDocumentEditor] Failed to save content:", error);
          const latest = pendingRef.current;
          if (!latest || documentKey(latest.scope, latest.id) !== key) {
            failedRef.current.set(key, pending);
          }
          if (savingSeqRef.current === saveSeq) onError();
        });
    },
    [onError],
  );

  const flushQueuedSave = useCallback(() => {
    const pending = pendingRef.current;
    if (!pending) return;
    pendingRef.current = null;
    void saveNow(pending, { immediateSync: true });
  }, [saveNow]);

  const queueSave = useCallback(
    (pending: Omit<PendingDocumentSave, "saveContent">) => {
      const queued = { ...pending, saveContent: saveContentRef.current };
      pendingRef.current = queued;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        flushQueuedSave();
      }, 2000);
    },
    [flushQueuedSave],
  );

  const saveImmediately = useCallback(
    (pending: Omit<PendingDocumentSave, "saveContent">, opts?: ContentSaveOptions) =>
      saveNow({ ...pending, saveContent: saveContentRef.current }, opts),
    [saveNow],
  );

  const flushPendingSave = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const pending = pendingRef.current;
    if (pending) {
      pendingRef.current = null;
      void saveNow(pending, { immediateSync: true });
    }

    const failedSaves = Array.from(failedRef.current.values());
    failedRef.current.clear();
    failedSaves.forEach((failed) => void saveNow(failed, { immediateSync: true }));

    if (!pending && failedSaves.length === 0) {
      flushSyncRef.current?.(currentDocIdRef.current);
    }
  }, [currentDocIdRef, saveNow]);

  const clear = useCallback((key: string) => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const pending = pendingRef.current;
    if (pending && documentKey(pending.scope, pending.id) === key) pendingRef.current = null;
    failedRef.current.delete(key);
  }, []);

  const forgetFailure = useCallback((key: string) => failedRef.current.delete(key), []);
  const hasPending = useCallback(() => pendingRef.current !== null, []);
  const advancePendingRevision = useCallback((revision: number) => {
    if (pendingRef.current) pendingRef.current.baseRevision = revision;
  }, []);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      const pending = pendingRef.current !== null || failedRef.current.size > 0;
      flushPendingSave();
      if (pending) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [flushPendingSave]);

  return {
    queueSave,
    saveImmediately,
    flushPendingSave,
    clear,
    forgetFailure,
    hasPending,
    advancePendingRevision,
  };
}
