/**
 * AppContext — Global app state: timer, categories, server data
 */
import { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import type { InitData, Phase } from "../types";
import { useTimer } from "../hooks/useTimer";
import type { UseTimerReturn } from "../hooks/useTimer";
import { serverCall } from "../lib/serverCall";
import * as TaskStore from "../lib/taskStore";
import * as MemoStore from "../lib/memoStore";
import * as RecordCache from "../lib/recordCache";

interface AppContextValue {
  timer: UseTimerReturn;
  spreadsheetUrl: string;
  isLoading: boolean;
  error: string | null;
  /** Save a break record to the server + IDB cache */
  saveBreakRecord: (timerState: import("../types").TimerState) => Promise<void>;
}

const AppContext = createContext<AppContextValue | null>(null);

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
  const [spreadsheetUrl, setSpreadsheetUrl] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const saveBreakRecord = useCallback(async (timerState: import("../types").TimerState) => {
    const now = new Date();
    const startTime = new Date(timerState.startTimestamp!);
    const breakType = timerState.breakType || timerState.phase;
    const durationSeconds =
      (breakType === "shortBreak"
        ? timerState.config.shortBreakMinutes
        : timerState.config.longBreakMinutes) * 60;
    const record = {
      id: crypto.randomUUID(),
      date: formatDate(startTime),
      startTime: startTime.toISOString(),
      endTime: now.toISOString(),
      durationSeconds,
      actualDurationSeconds: Math.round((now.getTime() - startTime.getTime()) / 1000),
      type: breakType,
      content: "",
      category: "",
      workInterruptions: 0,
      nonWorkInterruptions: 0,
      workInterruptionSeconds: 0,
      nonWorkInterruptionSeconds: 0,
      completionStatus: "completed",
      pomodoroSetIndex: timerState.pomodoroSetIndex,
    };
    try {
      await serverCall("saveRecord", record);
      await RecordCache.upsertRecord(record);
    } catch (err) {
      console.error("休憩記録の保存に失敗:", err);
    }
  }, []);

  // refreshAll is now a no-op (cache events drive UI updates)
  const refreshAll = useCallback(async () => {}, []);

  const onTargetReached = useCallback((_phase: Phase) => {
    // Tab switching will be handled by NavigationContext
  }, []);

  const timer = useTimer(onTargetReached, saveBreakRecord, refreshAll);

  // Init: load server data + initialize stores (EntityStore/TaskStore/MemoStore/RecordCache)
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
        setSpreadsheetUrl(d.spreadsheetUrl || "");

        // Initialize stores: MemoStore.init registers "memos" store,
        // RecordCache.registerStores registers record stores,
        // then TaskStore.init registers task stores + opens IDB (EntityStore.init)
        MemoStore.init(d.memos || [], d.memoTags || []);
        RecordCache.registerStores();
        await TaskStore.init({ projects: d.projects, cases: d.cases, tasks: d.tasks });

        // Load all stores in parallel (MemoStore, TaskStore, RecordCache are independent IDB stores)
        await Promise.all([
          MemoStore.loadData(),
          TaskStore.loadData(),
          RecordCache.populateFromBulk(d.recentRecordsBulk || [], d.recentInterruptionsBulk || []),
        ]);

        setIsLoading(false);
      })
      .catch((e) => {
        console.error("Init failed:", e);
        setError(String(e));
        setIsLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AppContext.Provider
      value={{
        timer,
        spreadsheetUrl,
        isLoading,
        error,
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
