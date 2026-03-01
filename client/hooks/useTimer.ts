/**
 * useTimer — Timer state machine hook
 * Ports App IIFE timer engine to React
 */
import { useState, useEffect, useRef, useCallback } from "react";
import type {
  Phase,
  TimerConfig,
  TimerState,
  InterruptionEntry,
  CurrentInterruption,
} from "../types";
import { STORAGE_KEYS, lsGetJSON, lsSetJSON } from "../lib/localStorage";
import { notify } from "../lib/notification";

const DEFAULT_CONFIG: TimerConfig = {
  patternName: "Standard",
  workMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  pomodorosBeforeLongBreak: 4,
};

function createInitialState(): TimerState {
  return {
    phase: "idle",
    breakType: null,
    elapsedSeconds: 0,
    targetReached: false,
    startTimestamp: null,
    totalSeconds: 0,
    pomodoroSetIndex: 1,
    interruptions: [],
    currentInterruption: null,
    interruptionElapsed: 0,
    config: { ...DEFAULT_CONFIG },
    configPatterns: [],
    categories: [],
    interruptionCategories: [],
  };
}

function loadSavedState(): TimerState {
  const base = createInitialState();
  const saved = lsGetJSON<Partial<TimerState>>(STORAGE_KEYS.TIMER_STATE);
  if (!saved) return base;

  // Merge saved state into base, preserving config sub-object merge
  const result = { ...base };
  for (const k of Object.keys(saved) as (keyof TimerState)[]) {
    if (k === "config") {
      result.config = { ...base.config, ...(saved.config || {}) };
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (result as any)[k] = saved[k];
    }
  }
  return result;
}

export interface UseTimerReturn {
  state: TimerState;
  startWork: () => void;
  startInterruption: () => void;
  endInterruption: (type: "work" | "nonWork", category: string, note: string) => void;
  discardInterruption: () => void;
  completeBreak: () => void;
  onRecordSaved: () => void;
  startNextWork: () => void;
  endWorkSession: () => void;
  continueWork: () => Promise<void>;
  endSession: () => Promise<void>;
  onPatternChange: (patternName: string) => void;
  setCustomConfig: (
    partial: Partial<
      Pick<
        TimerConfig,
        "workMinutes" | "shortBreakMinutes" | "longBreakMinutes" | "pomodorosBeforeLongBreak"
      >
    >,
  ) => void;
  setConfigPatterns: (patterns: TimerConfig[]) => void;
  setCategories: (cats: TimerState["categories"]) => void;
  setInterruptionCategories: (cats: TimerState["interruptionCategories"]) => void;
  clearState: () => void;
  saveState: () => void;
  /** Get formatted display time string */
  displayTime: string;
  /** Phase label text */
  phaseLabel: string;
  /** Whether timer is in overtime */
  isOvertime: boolean;
  /** Work progress text during interruption */
  workProgressText: string;
  /** Data-phase attribute value for CSS styling */
  dataPhase: string;
}

export function useTimer(
  onTargetReachedCallback?: (phase: Phase) => void,
  saveBreakRecord?: (state: TimerState) => Promise<void>,
  refreshAll?: () => void,
): UseTimerReturn {
  const [state, setState] = useState<TimerState>(loadSavedState);
  const stateRef = useRef(state);
  stateRef.current = state;

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const targetReachedFiredRef = useRef(false);

  // --- Persistence ---
  const persistState = useCallback((s: TimerState) => {
    lsSetJSON(STORAGE_KEYS.TIMER_STATE, s);
  }, []);

  const saveStateDebounced = useCallback(() => {
    if (saveTimerRef.current) return;
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      persistState(stateRef.current);
    }, 5000);
  }, [persistState]);

  const flushSaveState = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
      persistState(stateRef.current);
    }
  }, [persistState]);

  // Flush on beforeunload
  useEffect(() => {
    const handler = () => flushSaveState();
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [flushSaveState]);

  // --- Tick ---
  const tick = useCallback(() => {
    setState((prev) => {
      const now = Date.now();

      if (prev.phase === "interrupted" && prev.currentInterruption) {
        // During interruption, just trigger re-render for display time update
        return { ...prev };
      }

      if (!prev.startTimestamp) return prev;

      const elapsed = now - prev.startTimestamp - prev.interruptionElapsed;
      const elapsedSeconds = Math.max(0, Math.floor(elapsed / 1000));

      const next = { ...prev, elapsedSeconds };

      // Target reached check
      if (!prev.targetReached && elapsedSeconds >= prev.totalSeconds && prev.totalSeconds > 0) {
        next.targetReached = true;
        if (!targetReachedFiredRef.current) {
          targetReachedFiredRef.current = true;
          // Fire notification in next microtask to avoid setState-in-setState
          Promise.resolve().then(() => {
            if (prev.phase === "work") {
              notify("作業時間到達", "設定時間に達しました。");
            } else if (prev.phase === "shortBreak" || prev.phase === "longBreak") {
              notify("休憩時間到達", "設定時間に達しました。");
            }
            onTargetReachedCallback?.(prev.phase);
          });
        }
      }

      return next;
    });
    saveStateDebounced();
  }, [onTargetReachedCallback, saveStateDebounced]);

  // --- Interval management ---
  const startInterval = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(tick, 1000);
  }, [tick]);

  const stopInterval = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopInterval();
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [stopInterval]);

  // --- Restore timer on mount ---
  useEffect(() => {
    const s = stateRef.current;
    if (s.phase === "idle" || s.phase === "breakDone") return;

    if (s.phase === "interrupted") {
      startInterval();
      return;
    }

    // Wall-clock recovery
    if (s.startTimestamp) {
      const now = Date.now();
      const elapsed = now - s.startTimestamp - s.interruptionElapsed;
      const elapsedSeconds = Math.max(0, Math.floor(elapsed / 1000));

      setState((prev) => {
        const next = { ...prev, elapsedSeconds };
        if (!prev.targetReached && elapsedSeconds >= prev.totalSeconds && prev.totalSeconds > 0) {
          next.targetReached = true;
          Promise.resolve().then(() => {
            if (prev.phase === "work") {
              notify("作業時間到達", "設定時間に達しました。");
            } else if (prev.phase === "shortBreak" || prev.phase === "longBreak") {
              notify("休憩時間到達", "設定時間に達しました。");
            }
            onTargetReachedCallback?.(prev.phase);
          });
        }
        return next;
      });
      startInterval();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Actions ---
  const startTimer = useCallback(
    (phase: Phase, durationMinutes: number) => {
      targetReachedFiredRef.current = false;
      setState((prev) => {
        const next: TimerState = {
          ...prev,
          phase,
          totalSeconds: durationMinutes * 60,
          elapsedSeconds: 0,
          targetReached: false,
          startTimestamp: Date.now(),
          interruptionElapsed: 0,
        };
        if (phase === "work") {
          next.interruptions = [];
          next.currentInterruption = null;
        }
        persistState(next);
        return next;
      });
      startInterval();
    },
    [persistState, startInterval],
  );

  const startWork = useCallback(() => {
    startTimer("work", stateRef.current.config.workMinutes);
  }, [startTimer]);

  const startInterruption = useCallback(() => {
    if (stateRef.current.phase !== "work") return;
    const id = crypto.randomUUID();
    setState((prev) => {
      const next: TimerState = {
        ...prev,
        phase: "interrupted",
        currentInterruption: { id, startTimestamp: Date.now() },
      };
      persistState(next);
      return next;
    });
  }, [persistState]);

  const endInterruption = useCallback(
    (type: "work" | "nonWork", category: string, note: string) => {
      if (stateRef.current.phase !== "interrupted" || !stateRef.current.currentInterruption) return;

      const now = Date.now();
      setState((prev) => {
        if (!prev.currentInterruption) return prev;
        const durationMs = now - prev.currentInterruption.startTimestamp;
        const durationSeconds = Math.round(durationMs / 1000);

        const entry: InterruptionEntry = {
          id: prev.currentInterruption.id,
          type,
          startTime: new Date(prev.currentInterruption.startTimestamp).toISOString(),
          endTime: new Date(now).toISOString(),
          durationSeconds,
          category,
          note,
        };

        const next: TimerState = {
          ...prev,
          phase: "work",
          interruptions: [...prev.interruptions, entry],
          interruptionElapsed: prev.interruptionElapsed + durationMs,
          currentInterruption: null,
        };
        persistState(next);
        return next;
      });
    },
    [persistState],
  );

  const discardInterruption = useCallback(() => {
    if (stateRef.current.phase !== "interrupted" || !stateRef.current.currentInterruption) return;
    setState((prev) => {
      const next: TimerState = {
        ...prev,
        phase: "work",
        currentInterruption: null,
      };
      persistState(next);
      return next;
    });
  }, [persistState]);

  const clearStateAction = useCallback(() => {
    stopInterval();
    targetReachedFiredRef.current = false;
    setState((prev) => {
      const next: TimerState = {
        ...prev,
        phase: "idle",
        breakType: null,
        elapsedSeconds: 0,
        targetReached: false,
        startTimestamp: null,
        totalSeconds: 0,
        pomodoroSetIndex: 1,
        interruptions: [],
        currentInterruption: null,
        interruptionElapsed: 0,
      };
      persistState(next);
      return next;
    });
  }, [stopInterval, persistState]);

  const completeBreak = useCallback(() => {
    const { phase } = stateRef.current;
    if (phase !== "shortBreak" && phase !== "longBreak") return;
    setState((prev) => {
      const next: TimerState = {
        ...prev,
        breakType: prev.phase as "shortBreak" | "longBreak",
        phase: "breakDone",
      };
      persistState(next);
      return next;
    });
  }, [persistState]);

  const onRecordSaved = useCallback(() => {
    const s = stateRef.current;
    const limit = s.config.pomodorosBeforeLongBreak;
    const isLongBreak = s.pomodoroSetIndex >= limit;

    if (isLongBreak) {
      setState((prev) => ({ ...prev, pomodoroSetIndex: 1 }));
      startTimer("longBreak", s.config.longBreakMinutes);
    } else {
      setState((prev) => ({ ...prev, pomodoroSetIndex: prev.pomodoroSetIndex + 1 }));
      startTimer("shortBreak", s.config.shortBreakMinutes);
    }
  }, [startTimer]);

  const startNextWork = useCallback(() => {
    const s = stateRef.current;
    const limit = s.config.pomodorosBeforeLongBreak;
    if (s.pomodoroSetIndex >= limit) {
      setState((prev) => ({ ...prev, pomodoroSetIndex: 1 }));
    } else {
      setState((prev) => ({ ...prev, pomodoroSetIndex: prev.pomodoroSetIndex + 1 }));
    }
    startTimer("work", s.config.workMinutes);
  }, [startTimer]);

  const endWorkSession = useCallback(() => {
    clearStateAction();
  }, [clearStateAction]);

  const continueWork = useCallback(async () => {
    const s = stateRef.current;
    if (s.phase !== "breakDone" && s.phase !== "shortBreak" && s.phase !== "longBreak") return;
    const bt = s.breakType || s.phase;
    setState((prev) => ({ ...prev, breakType: bt as "shortBreak" | "longBreak" }));
    if (saveBreakRecord) {
      await saveBreakRecord(stateRef.current);
    }
    refreshAll?.();
    startTimer("work", s.config.workMinutes);
  }, [saveBreakRecord, refreshAll, startTimer]);

  const endSession = useCallback(async () => {
    const s = stateRef.current;
    if (s.phase !== "breakDone" && s.phase !== "shortBreak" && s.phase !== "longBreak") return;
    const bt = s.breakType || s.phase;
    setState((prev) => ({ ...prev, breakType: bt as "shortBreak" | "longBreak" }));
    if (saveBreakRecord) {
      await saveBreakRecord(stateRef.current);
    }
    clearStateAction();
    refreshAll?.();
  }, [saveBreakRecord, clearStateAction, refreshAll]);

  const onPatternChange = useCallback(
    (patternName: string) => {
      setState((prev) => {
        const pattern = prev.configPatterns.find((p) => p.patternName === patternName);
        if (!pattern) return prev;
        const next = { ...prev, config: pattern };
        persistState(next);
        return next;
      });
    },
    [persistState],
  );

  const setConfigPatterns = useCallback(
    (patterns: TimerConfig[]) => {
      setState((prev) => {
        const savedName = prev.config.patternName;
        const match = patterns.find((p) => p.patternName === savedName);
        const config = match || patterns.find((p) => p.isActive) || patterns[0] || prev.config;
        const next = { ...prev, configPatterns: patterns, config };
        persistState(next);
        return next;
      });
    },
    [persistState],
  );

  const setCustomConfig = useCallback(
    (
      partial: Partial<
        Pick<
          TimerConfig,
          "workMinutes" | "shortBreakMinutes" | "longBreakMinutes" | "pomodorosBeforeLongBreak"
        >
      >,
    ) => {
      setState((prev) => {
        const next = {
          ...prev,
          config: { ...prev.config, ...partial, patternName: "カスタム" },
        };
        persistState(next);
        return next;
      });
    },
    [persistState],
  );

  const setCategories = useCallback((cats: TimerState["categories"]) => {
    setState((prev) => ({ ...prev, categories: cats }));
  }, []);

  const setInterruptionCategories = useCallback((cats: TimerState["interruptionCategories"]) => {
    setState((prev) => ({ ...prev, interruptionCategories: cats }));
  }, []);

  // --- Derived display values ---
  const now = Date.now();
  let displaySeconds: number;
  if (state.phase === "interrupted" && state.currentInterruption) {
    displaySeconds = Math.max(
      0,
      Math.floor((now - state.currentInterruption.startTimestamp) / 1000),
    );
  } else {
    displaySeconds = state.elapsedSeconds || 0;
  }

  const hours = Math.floor(displaySeconds / 3600);
  const mins = Math.floor((displaySeconds % 3600) / 60);
  const secs = displaySeconds % 60;
  const displayTime =
    hours > 0
      ? `${hours}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
      : `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;

  const isOvertime =
    state.elapsedSeconds >= state.totalSeconds &&
    state.totalSeconds > 0 &&
    ["work", "shortBreak", "longBreak", "breakDone"].includes(state.phase);

  const labels: Record<Phase, string> = {
    idle: "準備完了",
    work: isOvertime ? "延長中" : "作業中",
    interrupted: "中断中",
    shortBreak: isOvertime ? "延長中" : "短い休憩",
    longBreak: isOvertime ? "延長中" : "長い休憩",
    breakDone: "休憩終了",
  };
  let phaseLabel = labels[state.phase] || "";
  if (
    ["work", "shortBreak", "longBreak", "breakDone"].includes(state.phase) &&
    state.totalSeconds > 0
  ) {
    const targetMins = Math.floor(state.totalSeconds / 60);
    const targetSecs = state.totalSeconds % 60;
    const targetStr =
      targetSecs > 0 ? `${targetMins}:${String(targetSecs).padStart(2, "0")}` : `${targetMins}:00`;
    phaseLabel += ` (${targetStr})`;
  }

  let workProgressText = "";
  if (state.phase === "interrupted" && state.totalSeconds > 0) {
    const we = state.elapsedSeconds || 0;
    const wm = Math.floor(we / 60);
    const ws = we % 60;
    const tm = Math.floor(state.totalSeconds / 60);
    const ts = state.totalSeconds % 60;
    workProgressText = `作業 ${String(wm).padStart(2, "0")}:${String(ws).padStart(2, "0")} / ${String(tm).padStart(2, "0")}:${String(ts).padStart(2, "0")}`;
  }

  let dataPhase = state.phase as string;
  if (dataPhase === "breakDone") dataPhase = state.breakType || "shortBreak";

  return {
    state,
    startWork,
    startInterruption,
    endInterruption,
    discardInterruption,
    completeBreak,
    onRecordSaved,
    startNextWork,
    endWorkSession,
    continueWork,
    endSession,
    onPatternChange,
    setCustomConfig,
    setConfigPatterns,
    setCategories,
    setInterruptionCategories,
    clearState: clearStateAction,
    saveState: () => persistState(stateRef.current),
    displayTime,
    phaseLabel,
    isOvertime,
    workProgressText,
    dataPhase,
  };
}
