/**
 * useDateSelector — Date selection, week strip, record counts
 * Now uses useRecordCache for data access (IDB cache with server fallback)
 */
import { useState, useCallback, useEffect } from "react";
import type { TodayStats, PomodoroRecord, InterruptionRecord } from "../types";
import { useRecordCache } from "./useRecordCache";
import * as RecordCache from "../lib/recordCache";
import { serverCall } from "../lib/serverCall";

function getTodayStr(): string {
  const d = new Date();
  return formatDateStr(d);
}

function formatDateStr(d: Date): string {
  return (
    d.getFullYear() +
    "-" +
    String(d.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(d.getDate()).padStart(2, "0")
  );
}

function getMonday(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return formatDateStr(d);
}

export function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + days);
  return formatDateStr(d);
}

export function formatLabel(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  const weekDays = ["日", "月", "火", "水", "木", "金", "土"];
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const dow = weekDays[d.getDay()];
  return `${month}月${day}日(${dow})`;
}

export interface UseDateSelectorReturn {
  selectedDate: string;
  weekStartDate: string;
  weekRecordCounts: Record<string, number>;
  isToday: boolean;
  selectDate: (dateStr: string) => void;
  prevWeek: () => void;
  nextWeek: () => void;
  goToToday: () => void;
  loadWeekCounts: () => void;
  onRecordSaved: () => void;
  /** Stats/records for the selected date */
  dateStats: TodayStats;
  dateRecords: PomodoroRecord[];
  dateInterruptions: InterruptionRecord[];
  isLoading: boolean;
}

export function useDateSelector(): UseDateSelectorReturn {
  const today = getTodayStr();
  const [selectedDate, setSelectedDate] = useState(today);
  const [weekStartDate, setWeekStartDate] = useState(() => getMonday(today));
  const [weekRecordCounts, setWeekRecordCounts] = useState<Record<string, number>>({});

  const isToday = selectedDate === getTodayStr();

  // Data comes from IDB cache (with server fallback for cache misses)
  const cache = useRecordCache(selectedDate);

  const loadWeekCounts = useCallback(() => {
    // Check if week is within cache range
    const weekEnd = addDays(weekStartDate, 6);
    if (RecordCache.hasRecordsForDate(weekStartDate) && RecordCache.hasRecordsForDate(weekEnd)) {
      // All 7 days are in cache range — compute from IDB
      RecordCache.getWeekRecordCounts(weekStartDate).then((counts) => {
        setWeekRecordCounts(counts);
      });
    } else {
      // Some days outside cache range — fetch from server
      serverCall("getWeekRecordCounts", weekStartDate)
        .then((counts) => {
          setWeekRecordCounts((counts as Record<string, number>) || {});
        })
        .catch((e) => console.error("loadWeekCounts failed:", e));
    }
  }, [weekStartDate]);

  const selectDate = useCallback((dateStr: string) => {
    const todayNow = getTodayStr();
    if (dateStr > todayNow) return;
    setSelectedDate(dateStr);
    setWeekStartDate(getMonday(dateStr));
  }, []);

  const prevWeek = useCallback(() => {
    setWeekStartDate((prev) => addDays(prev, -7));
  }, []);

  const nextWeek = useCallback(() => {
    const todayNow = getTodayStr();
    setWeekStartDate((prev) => {
      const newStart = addDays(prev, 7);
      if (newStart > todayNow) return prev;
      return newStart;
    });
  }, []);

  const goToToday = useCallback(() => {
    selectDate(getTodayStr());
  }, [selectDate]);

  // Refresh week counts when cache changes (upsert from record save)
  useEffect(() => {
    const handler = (payload: any) => {
      if (payload?.op === "upsert") {
        loadWeekCounts();
      }
    };
    RecordCache.on(handler);
    return () => RecordCache.off(handler);
  }, [loadWeekCounts]);

  // Legacy callback (kept for API compatibility)
  const onRecordSaved = useCallback(() => {
    loadWeekCounts();
  }, [loadWeekCounts]);

  return {
    selectedDate,
    weekStartDate,
    weekRecordCounts,
    isToday,
    selectDate,
    prevWeek,
    nextWeek,
    goToToday,
    loadWeekCounts,
    onRecordSaved,
    dateStats: cache.stats,
    dateRecords: cache.records,
    dateInterruptions: cache.interruptions,
    isLoading: cache.isLoading,
  };
}
