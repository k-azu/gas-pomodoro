/**
 * useTaskRecordCache — Lazy, IDB-backed record access by taskId.
 *
 * Nothing is read until enabled becomes true. On first enable, cached records are
 * shown while the authoritative task records are fetched from the server.
 */
import { useState, useEffect, useCallback, useRef } from "react";
import type { PomodoroRecord, InterruptionRecord } from "../types";
import * as RecordCache from "../lib/recordCache";
import { serverCall } from "../lib/serverCall";

export interface UseTaskRecordCacheReturn {
  records: PomodoroRecord[];
  interruptions: InterruptionRecord[];
  isLoading: boolean;
  hasLoaded: boolean;
  hasError: boolean;
}

const inFlightRequests = new Map<string, Promise<PomodoroRecord[]>>();

function fetchTaskRecords(taskId: string): Promise<PomodoroRecord[]> {
  const existing = inFlightRequests.get(taskId);
  if (existing) return existing;

  const request = (
    serverCall("getTaskPomodoroRecords", taskId) as Promise<PomodoroRecord[]>
  ).finally(() => {
    if (inFlightRequests.get(taskId) === request) inFlightRequests.delete(taskId);
  });
  inFlightRequests.set(taskId, request);
  return request;
}

export function useTaskRecordCache(taskId: string, enabled: boolean): UseTaskRecordCacheReturn {
  const [records, setRecords] = useState<PomodoroRecord[]>([]);
  const [interruptions, setInterruptions] = useState<InterruptionRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);
  const currentTaskId = useRef(taskId);
  currentTaskId.current = taskId;

  const loadFromIDB = useCallback(async (tid: string) => {
    const recs = await RecordCache.getRecordsByTaskId(tid);
    if (tid !== currentTaskId.current) return;
    const pomodoroIds = recs.map((r) => r.id);
    const ints =
      pomodoroIds.length > 0 ? await RecordCache.getInterruptionsByPomodoroIds(pomodoroIds) : [];
    if (tid !== currentTaskId.current) return;
    recs.sort((a, b) => (b.startTime > a.startTime ? 1 : -1));
    setRecords(recs);
    setInterruptions(ints);
    return recs;
  }, []);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;

    async function load() {
      setIsLoading(true);
      setHasLoaded(false);
      setHasError(false);
      await loadFromIDB(taskId);
      if (cancelled) return;

      try {
        const serverRecords = await fetchTaskRecords(taskId);
        if (cancelled) return;
        await RecordCache.replaceTaskRecords(taskId, serverRecords);
        if (cancelled) return;
        await loadFromIDB(taskId);
        if (!cancelled) setHasLoaded(true);
      } catch (e) {
        console.error("useTaskRecordCache: server fetch failed:", e);
        if (!cancelled) setHasError(true);
      }
      if (!cancelled) setIsLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [enabled, taskId, loadFromIDB]);

  // Listen for cache changes
  useEffect(() => {
    if (!enabled) return;
    const handler = () => {
      loadFromIDB(currentTaskId.current);
    };
    RecordCache.on(handler);
    return () => RecordCache.off(handler);
  }, [enabled, loadFromIDB]);

  return { records, interruptions, isLoading, hasLoaded, hasError };
}
