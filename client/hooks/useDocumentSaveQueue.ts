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
  onStart?: (pending: PendingDocumentSave) => void;
  onError: (pending: PendingDocumentSave) => void;
}

export function useDocumentSaveQueue({
  currentDocIdRef,
  saveContent,
  flushSync,
  onStart,
  onError,
}: UseDocumentSaveQueueOptions) {
  const saveContentRef = useRef(saveContent);
  const flushSyncRef = useRef(flushSync);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<PendingDocumentSave | null>(null);
  const failedRef = useRef(new Map<string, PendingDocumentSave>());
  const inFlightRef = useRef(new Map<string, number>());
  const inFlightSavesRef = useRef(new Map<string, Set<Promise<void>>>());
  const savingSeqRef = useRef(0);
  const latestSaveSeqRef = useRef(new Map<string, number>());
  const flushInFlightRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    saveContentRef.current = saveContent;
    flushSyncRef.current = flushSync;
  }, [saveContent, flushSync]);

  const saveNow = useCallback(
    (pending: PendingDocumentSave, opts?: ContentSaveOptions, notifyStart = true) => {
      const saveSeq = ++savingSeqRef.current;
      const key = documentKey(pending.scope, pending.id);
      latestSaveSeqRef.current.set(key, saveSeq);
      inFlightRef.current.set(key, (inFlightRef.current.get(key) ?? 0) + 1);
      const saving = pending.saveContent(pending.id, pending.content, {
        ...opts,
        baseRevision: pending.baseRevision,
        mutationId: pending.mutationId,
      });
      if (notifyStart) onStart?.(pending);
      const tracked = saving
        .then(() => {
          if (latestSaveSeqRef.current.get(key) === saveSeq) {
            failedRef.current.delete(key);
          }
        })
        .catch((error) => {
          console.error("[useDocumentEditor] Failed to save content:", error);
          const latest = pendingRef.current;
          const isLatestSave = latestSaveSeqRef.current.get(key) === saveSeq;
          const hasNewerQueuedSave =
            latest !== null && documentKey(latest.scope, latest.id) === key;
          if (isLatestSave && !hasNewerQueuedSave) {
            failedRef.current.set(key, pending);
          }
          if (isLatestSave) onError(pending);
          throw error;
        })
        .finally(() => {
          const remaining = (inFlightRef.current.get(key) ?? 1) - 1;
          if (remaining > 0) inFlightRef.current.set(key, remaining);
          else inFlightRef.current.delete(key);
          const saves = inFlightSavesRef.current.get(key);
          saves?.delete(tracked);
          if (saves?.size === 0) inFlightSavesRef.current.delete(key);
        });
      const saves = inFlightSavesRef.current.get(key) ?? new Set<Promise<void>>();
      saves.add(tracked);
      inFlightSavesRef.current.set(key, saves);
      return tracked;
    },
    [onError, onStart],
  );

  const flushQueuedSave = useCallback(() => {
    const pending = pendingRef.current;
    if (!pending) return Promise.resolve();
    pendingRef.current = null;
    return saveNow(pending, { immediateSync: true });
  }, [saveNow]);

  const queueSave = useCallback(
    (pending: Omit<PendingDocumentSave, "saveContent">) => {
      const queued = { ...pending, saveContent: saveContentRef.current };
      pendingRef.current = queued;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        void flushQueuedSave().catch(() => undefined);
      }, 2000);
    },
    [flushQueuedSave],
  );

  const saveImmediately = useCallback(
    (pending: Omit<PendingDocumentSave, "saveContent">, opts?: ContentSaveOptions) =>
      saveNow({ ...pending, saveContent: saveContentRef.current }, opts),
    [saveNow],
  );

  const flushPendingSaveInternal = useCallback(
    (notifyStart: boolean) => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      const pending = pendingRef.current;
      const saves: Promise<void>[] = [];
      if (pending) {
        pendingRef.current = null;
        saves.push(saveNow(pending, { immediateSync: true }, notifyStart));
      }

      const failedSaves = Array.from(failedRef.current.values());
      failedRef.current.clear();
      failedSaves.forEach((failed) =>
        saves.push(saveNow(failed, { immediateSync: true }, notifyStart)),
      );

      if (!pending && failedSaves.length === 0) {
        flushSyncRef.current?.(currentDocIdRef.current);
      }
      return Promise.all(saves).then(() => undefined);
    },
    [currentDocIdRef, saveNow],
  );

  const flushPendingSave = useCallback(() => {
    if (flushInFlightRef.current) return flushInFlightRef.current;
    const drain = async () => {
      do {
        await flushPendingSaveInternal(true);
      } while (pendingRef.current !== null || failedRef.current.size > 0);
    };
    const flushing = drain().finally(() => {
      if (flushInFlightRef.current === flushing) flushInFlightRef.current = null;
    });
    flushInFlightRef.current = flushing;
    return flushing;
  }, [flushPendingSaveInternal]);

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
  const waitForInFlight = useCallback(async (key: string) => {
    while (true) {
      const saves = Array.from(inFlightSavesRef.current.get(key) ?? []);
      if (saves.length === 0) return;
      await Promise.allSettled(saves);
    }
  }, []);
  const hasUnpersisted = useCallback((key: string) => {
    const pending = pendingRef.current;
    return (
      Boolean(pending && documentKey(pending.scope, pending.id) === key) ||
      failedRef.current.has(key) ||
      (inFlightRef.current.get(key) ?? 0) > 0
    );
  }, []);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      const pending = pendingRef.current !== null || failedRef.current.size > 0;
      // Keep the unload path persistence-only. Scheduling a React status update
      // here can prevent the IndexedDB transaction from finishing before reload.
      void flushPendingSaveInternal(false).catch(() => undefined);
      if (pending) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [flushPendingSaveInternal]);

  return {
    queueSave,
    saveImmediately,
    flushPendingSave,
    clear,
    forgetFailure,
    waitForInFlight,
    hasUnpersisted,
  };
}
