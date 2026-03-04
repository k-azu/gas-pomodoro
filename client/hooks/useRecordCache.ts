/**
 * useRecordCache — React hook for date-based record access via IDB cache
 * Falls back to server for dates outside cache range.
 */
import { useState, useEffect, useCallback, useRef } from "react";
import type { PomodoroRecord, InterruptionRecord, TodayStats } from "../types";
import * as RecordCache from "../lib/recordCache";
import { serverCall } from "../lib/serverCall";

const EMPTY_STATS: TodayStats = {
  completedPomodoros: 0,
  abandonedPomodoros: 0,
  totalWorkSeconds: 0,
  totalBreakSeconds: 0,
  totalWorkInterruptionSeconds: 0,
  totalNonWorkInterruptionSeconds: 0,
};

export interface UseRecordCacheReturn {
  records: PomodoroRecord[];
  interruptions: InterruptionRecord[];
  stats: TodayStats;
  isLoading: boolean;
  isCacheHit: boolean;
}

export function useRecordCache(dateStr: string): UseRecordCacheReturn {
  const [records, setRecords] = useState<PomodoroRecord[]>([]);
  const [interruptions, setInterruptions] = useState<InterruptionRecord[]>([]);
  const [stats, setStats] = useState<TodayStats>(EMPTY_STATS);
  const [isLoading, setIsLoading] = useState(true);
  const [isCacheHit, setIsCacheHit] = useState(false);
  const currentDate = useRef(dateStr);
  currentDate.current = dateStr;

  const loadFromIDB = useCallback(async (date: string) => {
    const recs = await RecordCache.getRecordsByDate(date);
    if (date !== currentDate.current) return; // stale
    const pomodoroIds = recs.map((r) => r.id);
    const ints =
      pomodoroIds.length > 0 ? await RecordCache.getInterruptionsByPomodoroIds(pomodoroIds) : [];
    if (date !== currentDate.current) return; // stale
    const st = await RecordCache.computeStatsForDate(date);
    if (date !== currentDate.current) return; // stale
    // Sort records newest first
    recs.sort((a, b) => (b.startTime > a.startTime ? 1 : -1));
    setRecords(recs);
    setInterruptions(ints);
    setStats(st);
  }, []);

  // Load data when dateStr changes
  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);

      if (RecordCache.hasRecordsForDate(dateStr)) {
        // Cache hit: serve from IDB
        setIsCacheHit(true);
        await loadFromIDB(dateStr);
        if (!cancelled) setIsLoading(false);
      } else {
        // Cache miss: fetch from server, populate IDB, then read
        setIsCacheHit(false);
        try {
          const data = (await serverCall("getDataForDate", dateStr)) as {
            todayStats: TodayStats;
            recentRecords: PomodoroRecord[];
            todayInterruptions: InterruptionRecord[];
          };
          if (cancelled) return;
          // Populate IDB with server response
          await RecordCache.populateFromServerResponse(
            dateStr,
            data.recentRecords || [],
            data.todayInterruptions || [],
          );
          if (cancelled) return;
          // Read from IDB (ensures consistency)
          await loadFromIDB(dateStr);
        } catch (e) {
          console.error("useRecordCache: server fetch failed:", e);
        }
        if (!cancelled) setIsLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [dateStr, loadFromIDB]);

  // Listen for cache changes and reload if relevant
  useEffect(() => {
    const handler = (payload: any) => {
      // Reload if the event matches our date, or is a bulk populate
      if (
        !payload?.dateStr ||
        payload.dateStr === currentDate.current ||
        payload.op === "populate"
      ) {
        loadFromIDB(currentDate.current);
      }
    };
    RecordCache.on(handler);
    return () => RecordCache.off(handler);
  }, [loadFromIDB]);

  return { records, interruptions, stats, isLoading, isCacheHit };
}
