/**
 * AppContext — Global app state: timer, categories, server data
 */
import { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import type { InitData, TodayStats, PomodoroRecord, InterruptionRecord, Phase } from "../types";
import { useTimer } from "../hooks/useTimer";
import type { UseTimerReturn } from "../hooks/useTimer";
import { serverCall } from "../lib/serverCall";
import * as TaskStore from "../lib/taskStore";
import * as MemoStore from "../lib/memoStore";

interface AppContextValue {
  timer: UseTimerReturn;
  todayStats: TodayStats;
  recentRecords: PomodoroRecord[];
  todayInterruptions: InterruptionRecord[];
  spreadsheetUrl: string;
  isLoading: boolean;
  error: string | null;
  refreshStats: () => Promise<void>;
  refreshAll: () => Promise<void>;
  /** Save a break record to the server */
  saveBreakRecord: (timerState: import("../types").TimerState) => Promise<void>;
}

const AppContext = createContext<AppContextValue | null>(null);

const EMPTY_STATS: TodayStats = {
  completedPomodoros: 0,
  abandonedPomodoros: 0,
  totalWorkSeconds: 0,
  totalBreakSeconds: 0,
  totalWorkInterruptionSeconds: 0,
  totalNonWorkInterruptionSeconds: 0,
};

function formatDate(d: Date): string {
  return (
    d.getFullYear() +
    "-" +
    String(d.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(d.getDate()).padStart(2, "0")
  );
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [todayStats, setTodayStats] = useState<TodayStats>(EMPTY_STATS);
  const [recentRecords, setRecentRecords] = useState<PomodoroRecord[]>([]);
  const [todayInterruptions, setTodayInterruptions] = useState<InterruptionRecord[]>([]);
  const [spreadsheetUrl, setSpreadsheetUrl] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshStats = useCallback(async () => {
    try {
      const data = (await serverCall("getRefreshData")) as {
        todayStats: TodayStats;
        recentRecords: PomodoroRecord[];
        todayInterruptions: InterruptionRecord[];
      };
      setTodayStats(data.todayStats || EMPTY_STATS);
      setRecentRecords(data.recentRecords || []);
      setTodayInterruptions(data.todayInterruptions || []);
    } catch (e) {
      console.error("refreshStats failed:", e);
    }
  }, []);

  const refreshAllRef = useRef(refreshStats);
  refreshAllRef.current = refreshStats;

  const refreshAll = useCallback(async () => {
    await refreshAllRef.current();
  }, []);

  const saveBreakRecord = useCallback(
    async (timerState: import("../types").TimerState) => {
      const now = new Date();
      const startTime = new Date(timerState.startTimestamp!);
      const breakType = timerState.breakType || timerState.phase;
      const durationSeconds =
        (breakType === "shortBreak"
          ? timerState.config.shortBreakMinutes
          : timerState.config.longBreakMinutes) * 60;
      const record = {
        id: crypto.randomUUID(),
        date: formatDate(now),
        startTime: startTime.toISOString(),
        endTime: now.toISOString(),
        durationSeconds,
        actualDurationSeconds: Math.round((now.getTime() - startTime.getTime()) / 1000),
        type: breakType,
        description: "",
        category: "",
        workInterruptions: 0,
        nonWorkInterruptions: 0,
        workInterruptionSeconds: 0,
        nonWorkInterruptionSeconds: 0,
        completionStatus: "completed",
        pomodoroSetIndex: timerState.pomodoroSetIndex,
      };
      await serverCall("saveRecord", record);
    },
    [],
  );

  const onTargetReached = useCallback((_phase: Phase) => {
    // Tab switching will be handled by NavigationContext
  }, []);

  const timer = useTimer(onTargetReached, saveBreakRecord, refreshAll);

  // Init: load server data + initialize stores (EntityStore/TaskStore/MemoStore)
  // Guard against StrictMode double-invocation which would race on MemoStore._serverMemos
  const initStarted = useRef(false);
  useEffect(() => {
    if (initStarted.current) return;
    initStarted.current = true;

    serverCall("getAllInitData")
      .then(async (data) => {
        const d = data as InitData;
        timer.setConfigPatterns(d.timerConfigs);
        timer.setCategories(d.categories);
        timer.setInterruptionCategories(d.interruptionCategories);
        setTodayStats(d.todayStats || EMPTY_STATS);
        setRecentRecords(d.recentRecords || []);
        setTodayInterruptions(d.todayInterruptions || []);
        setSpreadsheetUrl(d.spreadsheetUrl || "");

        // Initialize stores: MemoStore.init registers "memos" store,
        // then TaskStore.init registers task stores + opens IDB (EntityStore.init)
        MemoStore.init(d.memos || [], d.memoTags || []);
        await TaskStore.init();
        await MemoStore.loadData();
      })
      .catch((e) => {
        console.error("Init failed:", e);
        setError(String(e));
      })
      .finally(() => {
        setIsLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AppContext.Provider
      value={{
        timer,
        todayStats,
        recentRecords,
        todayInterruptions,
        spreadsheetUrl,
        isLoading,
        error,
        refreshStats,
        refreshAll,
        saveBreakRecord,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}
