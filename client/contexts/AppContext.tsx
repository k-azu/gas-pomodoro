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
import * as EntityStore from "../lib/entityStore";
import * as DocumentStore from "../lib/documentStore";
import { runWithDocumentEditorsFrozen } from "../lib/documentNavigationGuard";
import { readCurrentStandaloneDocumentTarget } from "../lib/documentWindow";

interface AppContextValue {
  timer: UseTimerReturn;
  spreadsheetUrl: string;
  webAppUrl: string;
  isLoading: boolean;
  error: string | null;
  /** Save a break record to the server + IDB cache */
  saveBreakRecord: (timerState: import("../types").TimerState) => Promise<void>;
  refreshDocuments: () => Promise<boolean>;
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
  const [webAppUrl, setWebAppUrl] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const hiddenAtRef = useRef<number | null>(null);
  const refreshPromiseRef = useRef<Promise<boolean> | null>(null);
  const refreshRequestedRef = useRef(false);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!DocumentStore.hasAnyPendingMetadata()) return;
      event.preventDefault();
      event.returnValue = "";
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState !== "hidden" || !DocumentStore.hasAnyPendingMetadata()) return;
      void DocumentStore.waitForAllMetadata().catch((metadataError) => {
        console.error("Document metadata flush on page hide failed:", metadataError);
      });
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

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

  const refreshDocuments = useCallback((): Promise<boolean> => {
    if (refreshPromiseRef.current) {
      refreshRequestedRef.current = true;
      return refreshPromiseRef.current;
    }
    const operation = (async () => {
      let refreshed = false;
      do {
        refreshRequestedRef.current = false;
        refreshed = await runWithDocumentEditorsFrozen(async () => {
          try {
            await DocumentStore.waitForAllMetadata();
            const generationBeforeFetch = DocumentStore.getLocalGeneration();
            const data = (await serverCall("getAllDocumentData")) as Pick<
              InitData,
              "memos" | "projects" | "cases" | "tasks"
            >;
            if (DocumentStore.getLocalGeneration() !== generationBeforeFetch) {
              refreshRequestedRef.current = true;
              return false;
            }
            DocumentStore.applyServerData({
              memos: data.memos || [],
              projects: data.projects || [],
              cases: data.cases || [],
              tasks: data.tasks || [],
            });
            return true;
          } catch (refreshError) {
            console.error("Document refresh failed:", refreshError);
            return false;
          }
        });
      } while (refreshRequestedRef.current);
      return refreshed;
    })();
    refreshPromiseRef.current = operation;
    const cleanup = () => {
      if (refreshPromiseRef.current === operation) refreshPromiseRef.current = null;
    };
    void operation.then(cleanup, cleanup);
    return operation;
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const handleDocumentEvent = (event: { op: string }) => {
      if (event.op !== "remoteInvalidation") return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        void refreshDocuments();
      }, 250);
    };
    DocumentStore.on(handleDocumentEvent);
    return () => {
      DocumentStore.off(handleDocumentEvent);
      if (timer) clearTimeout(timer);
    };
  }, [refreshDocuments]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        hiddenAtRef.current = Date.now();
        return;
      }
      const hiddenAt = hiddenAtRef.current;
      hiddenAtRef.current = null;
      if (hiddenAt !== null && Date.now() - hiddenAt >= 30 * 60 * 1000) {
        void refreshDocuments();
      }
    };
    const handleOnline = () => void refreshDocuments();
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("online", handleOnline);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("online", handleOnline);
    };
  }, [refreshDocuments]);

  // Init: load server data, initialize the document memory store, and retain IDB for records only.
  // Guard against StrictMode double-invocation which would race on MemoStore._serverMemos
  const initStarted = useRef(false);
  useEffect(() => {
    if (initStarted.current) return;
    initStarted.current = true;

    const standaloneTarget = readCurrentStandaloneDocumentTarget();
    const initRequest = standaloneTarget
      ? serverCall(
          "getDocumentViewInitData",
          standaloneTarget.tab === "memo"
            ? `memos:${standaloneTarget.memoId}`
            : `${standaloneTarget.taskNode.type === "project" ? "projects" : standaloneTarget.taskNode.type === "case" ? "cases" : "tasks"}:${standaloneTarget.taskNode.id}`,
        )
      : serverCall("getAllInitData");

    initRequest
      .then(async (data) => {
        const d = data as InitData;
        timer.setConfigPatterns(d.timerConfigs);
        timer.setCategories(d.categories);
        timer.setInterruptionCategories(d.interruptionCategories);
        setSpreadsheetUrl(d.spreadsheetUrl || "");
        setWebAppUrl(d.webAppUrl || "");

        DocumentStore.initialize({
          memos: d.memos || [],
          projects: d.projects || [],
          cases: d.cases || [],
          tasks: d.tasks || [],
        });
        MemoStore.init(d.memos || [], d.memoTags || []);
        RecordCache.registerStores();
        await TaskStore.init();
        // Document stores from older versions are deliberately left untouched for
        // manual recovery, but the new document path never registers or reads them.
        await EntityStore.init("gas_pomodoro", 4);

        await RecordCache.populateFromBulk(
          d.recentRecordsBulk || [],
          d.recentInterruptionsBulk || [],
        );

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
        webAppUrl,
        isLoading,
        error,
        saveBreakRecord,
        refreshDocuments,
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
