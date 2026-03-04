/**
 * useFormDraft — 2-second debounced localStorage persistence for form drafts.
 *
 * - `initialDraft`: value read from localStorage on mount (null if nothing stored)
 * - `saveDraft(draft)`: schedules a debounced write
 * - `clearDraft()`: immediately removes from localStorage and cancels pending writes
 * - beforeunload flushes any pending write
 * - unmount calls clearDraft (form gone → draft no longer needed)
 */
import { useEffect, useRef, useCallback } from "react";
import { lsGetJSON, lsSetJSON, lsRemove } from "../lib/localStorage";

const DEBOUNCE_MS = 2000;

interface UseFormDraftResult<T> {
  initialDraft: T | null;
  saveDraft: (draft: T) => void;
  clearDraft: () => void;
}

export function useFormDraft<T>(storageKey: string): UseFormDraftResult<T> {
  const initialDraftRef = useRef<T | null>(lsGetJSON<T>(storageKey));
  const pendingRef = useRef<T | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearedRef = useRef(false);

  const flush = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (pendingRef.current !== null && !clearedRef.current) {
      lsSetJSON(storageKey, pendingRef.current);
      pendingRef.current = null;
    }
  }, [storageKey]);

  const clearDraft = useCallback(() => {
    clearedRef.current = true;
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    pendingRef.current = null;
    lsRemove(storageKey);
  }, [storageKey]);

  const saveDraft = useCallback(
    (draft: T) => {
      clearedRef.current = false;
      pendingRef.current = draft;
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        if (pendingRef.current !== null && !clearedRef.current) {
          lsSetJSON(storageKey, pendingRef.current);
          pendingRef.current = null;
        }
      }, DEBOUNCE_MS);
    },
    [storageKey],
  );

  // beforeunload flush
  useEffect(() => {
    const onBeforeUnload = () => flush();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      // unmount → clearDraft (don't persist stale data)
      clearDraft();
    };
  }, [flush, clearDraft]);

  return {
    initialDraft: initialDraftRef.current,
    saveDraft,
    clearDraft,
  };
}
