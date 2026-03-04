/**
 * useTaskRecordCache — IDB-first record access by taskId, with server fallback.
 *
 * 1. Reads IDB via RecordCache.getRecordsByTaskId
 * 2. Compares IDB work-record count with pomodoroCount (from entity)
 * 3. If mismatch → fetches from server, upserts into IDB → auto-reloads via event
 */
import { useState, useEffect, useCallback, useRef } from "react";
import type { PomodoroRecord, InterruptionRecord } from "../types";
import * as RecordCache from "../lib/recordCache";
import { serverCall } from "../lib/serverCall";

export interface UseTaskRecordCacheReturn {
  records: PomodoroRecord[];
  interruptions: InterruptionRecord[];
  isLoading: boolean;
}

export function useTaskRecordCache(
  taskId: string,
  pomodoroCount: number,
): UseTaskRecordCacheReturn {
  const [records, setRecords] = useState<PomodoroRecord[]>([]);
  const [interruptions, setInterruptions] = useState<InterruptionRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const currentTaskId = useRef(taskId);
  currentTaskId.current = taskId;
  const fetchedRef = useRef(false);

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
    let cancelled = false;
    fetchedRef.current = false;

    async function load() {
      setIsLoading(true);
      const recs = await loadFromIDB(taskId);
      if (cancelled) return;

      const idbWorkCount = recs ? recs.filter((r) => r.type === "work").length : 0;

      if (idbWorkCount >= pomodoroCount || pomodoroCount === 0) {
        // IDB has all records
        setIsLoading(false);
        return;
      }

      // Mismatch — fetch from server
      if (fetchedRef.current) {
        setIsLoading(false);
        return;
      }
      fetchedRef.current = true;

      try {
        const serverRecs = (await serverCall("getTaskPomodoroRecords", taskId)) as PomodoroRecord[];
        if (cancelled) return;
        // Upsert each record into IDB (fires recordCacheChanged → loadFromIDB via event)
        for (const r of serverRecs) {
          await RecordCache.upsertRecord(r);
        }
      } catch (e) {
        console.error("useTaskRecordCache: server fetch failed:", e);
      }
      if (!cancelled) setIsLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [taskId, pomodoroCount, loadFromIDB]);

  // Listen for cache changes
  useEffect(() => {
    const handler = () => {
      loadFromIDB(currentTaskId.current);
    };
    RecordCache.on(handler);
    return () => RecordCache.off(handler);
  }, [loadFromIDB]);

  return { records, interruptions, isLoading };
}
