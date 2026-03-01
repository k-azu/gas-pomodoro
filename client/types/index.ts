export type * from "./timer";
export type * from "./entities";
export type * from "./records";
export type * from "./categories";

/** Server-side memo metadata returned by getAllInitData */
export interface MemoMetadata {
  id: string;
  name: string;
  tags: string[];
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Shape of getAllInitData response */
export interface InitData {
  timerConfigs: import("./timer").TimerConfig[];
  categories: import("./categories").CategoryItem[];
  interruptionCategories: import("./categories").CategoryItem[];
  todayStats: import("./records").TodayStats;
  recentRecords: import("./records").PomodoroRecord[];
  spreadsheetUrl: string;
  todayInterruptions: import("./records").InterruptionRecord[];
  memos: MemoMetadata[];
  memoTags: import("./categories").MemoTag[];
}

/** Shape of getAllTaskData response */
export interface TaskData {
  projects: import("./entities").Project[];
  cases: import("./entities").Case[];
  tasks: import("./entities").Task[];
}
