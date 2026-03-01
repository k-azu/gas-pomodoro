export type Phase =
  | "idle"
  | "work"
  | "interrupted"
  | "shortBreak"
  | "longBreak"
  | "breakDone";

export interface TimerConfig {
  patternName: string;
  workMinutes: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
  pomodorosBeforeLongBreak: number;
  isActive?: boolean;
}

export interface InterruptionEntry {
  id: string;
  type: "work" | "nonWork";
  startTime: string;
  endTime: string;
  durationSeconds: number;
  category: string;
  note: string;
}

export interface CurrentInterruption {
  id: string;
  startTimestamp: number;
}

export interface TimerState {
  phase: Phase;
  breakType: "shortBreak" | "longBreak" | null;
  elapsedSeconds: number;
  targetReached: boolean;
  startTimestamp: number | null;
  totalSeconds: number;
  pomodoroSetIndex: number;
  interruptions: InterruptionEntry[];
  currentInterruption: CurrentInterruption | null;
  interruptionElapsed: number;
  config: TimerConfig;
  configPatterns: TimerConfig[];
  categories: import("./categories").CategoryItem[];
  interruptionCategories: import("./categories").CategoryItem[];
}
