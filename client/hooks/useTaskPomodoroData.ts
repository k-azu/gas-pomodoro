/**
 * useTaskPomodoroData — Lazy server access for records linked to a task.
 *
 * Task footer data deliberately stays separate from the shared IndexedDB cache
 * used by date-based history and statistics.
 */
import { useState, useEffect, useCallback } from "react";
import type { PomodoroRecord, InterruptionRecord } from "../types";
import { serverCall } from "../lib/serverCall";

export interface UseTaskPomodoroDataReturn {
  records: PomodoroRecord[];
  interruptions: InterruptionRecord[];
  isLoading: boolean;
  hasLoaded: boolean;
  hasError: boolean;
  refresh: () => void;
}

interface TaskPomodoroData {
  records: PomodoroRecord[];
  interruptions: InterruptionRecord[];
}

const inFlightRequests = new Map<string, Promise<TaskPomodoroData>>();

function fetchTaskRecords(taskId: string): Promise<TaskPomodoroData> {
  const existing = inFlightRequests.get(taskId);
  if (existing) return existing;

  const request = (serverCall("getTaskPomodoroData", taskId) as Promise<TaskPomodoroData>).finally(
    () => {
      if (inFlightRequests.get(taskId) === request) inFlightRequests.delete(taskId);
    },
  );
  inFlightRequests.set(taskId, request);
  return request;
}

export function useTaskPomodoroData(taskId: string, enabled: boolean): UseTaskPomodoroDataReturn {
  const [records, setRecords] = useState<PomodoroRecord[]>([]);
  const [interruptions, setInterruptions] = useState<InterruptionRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [refreshSequence, setRefreshSequence] = useState(0);
  const refresh = useCallback(() => setRefreshSequence((sequence) => sequence + 1), []);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;

    async function load() {
      setIsLoading(true);
      setHasLoaded(false);
      setHasError(false);

      try {
        const data = await fetchTaskRecords(taskId);
        if (cancelled) return;
        setRecords([...(data.records || [])].sort((a, b) => (b.startTime > a.startTime ? 1 : -1)));
        setInterruptions(data.interruptions || []);
        setHasLoaded(true);
      } catch (e) {
        console.error("useTaskPomodoroData: server fetch failed:", e);
        if (!cancelled) setHasError(true);
      }
      if (!cancelled) setIsLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [enabled, taskId, refreshSequence]);

  return { records, interruptions, isLoading, hasLoaded, hasError, refresh };
}
