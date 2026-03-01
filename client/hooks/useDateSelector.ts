/**
 * useDateSelector — Date selection, week strip, record counts
 * Ports DateSelector IIFE to React hook
 */
import { useState, useCallback } from "react";
import type { TodayStats, PomodoroRecord, InterruptionRecord } from "../types";
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
}

const EMPTY_STATS: TodayStats = {
  completedPomodoros: 0,
  abandonedPomodoros: 0,
  totalWorkSeconds: 0,
  totalBreakSeconds: 0,
  totalWorkInterruptionSeconds: 0,
  totalNonWorkInterruptionSeconds: 0,
};

export function useDateSelector(
  initialStats: TodayStats,
  initialRecords: PomodoroRecord[],
  initialInterruptions: InterruptionRecord[],
): UseDateSelectorReturn {
  const today = getTodayStr();
  const [selectedDate, setSelectedDate] = useState(today);
  const [weekStartDate, setWeekStartDate] = useState(() => getMonday(today));
  const [weekRecordCounts, setWeekRecordCounts] = useState<Record<string, number>>({});
  const [dateStats, setDateStats] = useState<TodayStats>(initialStats);
  const [dateRecords, setDateRecords] = useState<PomodoroRecord[]>(initialRecords);
  const [dateInterruptions, setDateInterruptions] = useState<InterruptionRecord[]>(initialInterruptions);

  const isToday = selectedDate === getTodayStr();

  const loadDateData = useCallback((date: string) => {
    const todayNow = getTodayStr();
    const fn = date === todayNow ? "getRefreshData" : "getDataForDate";
    const args = date === todayNow ? [] : [date];
    serverCall(fn, ...args)
      .then((data: unknown) => {
        const d = data as {
          todayStats: TodayStats;
          recentRecords: PomodoroRecord[];
          todayInterruptions: InterruptionRecord[];
        };
        setDateStats(d.todayStats || EMPTY_STATS);
        setDateRecords(d.recentRecords || []);
        setDateInterruptions(d.todayInterruptions || []);
      })
      .catch((e) => console.error("loadDateData failed:", e));
  }, []);

  const loadWeekCounts = useCallback(() => {
    serverCall("getWeekRecordCounts", weekStartDate)
      .then((counts) => {
        setWeekRecordCounts((counts as Record<string, number>) || {});
      })
      .catch((e) => console.error("loadWeekCounts failed:", e));
  }, [weekStartDate]);

  const selectDate = useCallback(
    (dateStr: string) => {
      const todayNow = getTodayStr();
      if (dateStr > todayNow) return;
      setSelectedDate(dateStr);
      setWeekStartDate(getMonday(dateStr));
      loadDateData(dateStr);
    },
    [loadDateData],
  );

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

  const onRecordSaved = useCallback(() => {
    if (selectedDate === getTodayStr()) {
      loadDateData(selectedDate);
    }
    loadWeekCounts();
  }, [selectedDate, loadDateData, loadWeekCounts]);

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
    dateStats,
    dateRecords,
    dateInterruptions,
  };
}
