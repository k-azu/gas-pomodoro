export type * from "./timer";
export type * from "./entities";
export type * from "./records";
export type * from "./categories";

/** Server-side memo metadata returned by getAllInitData */
export interface MemoMetadata {
  id: string;
  name: string;
  content: string;
  tags: string[];
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  contentRevision: number;
  metadataRevision: number;
  lastContentMutationId: string;
  lastMetadataMutationId: string;
}

/** Shape of getAllInitData response */
export interface InitData {
  timerConfigs: import("./timer").TimerConfig[];
  categories: import("./categories").CategoryItem[];
  interruptionCategories: import("./categories").CategoryItem[];
  spreadsheetUrl: string;
  webAppUrl: string;
  recentRecordsBulk: import("./records").PomodoroRecord[];
  recentInterruptionsBulk: import("./records").InterruptionRecord[];
  memos: MemoMetadata[];
  memoTags: import("./categories").MemoTag[];
  projects?: import("./entities").Project[];
  cases?: import("./entities").Case[];
  tasks?: import("./entities").Task[];
}

/** Shape of getAllTaskData response */
export interface TaskData {
  projects: import("./entities").Project[];
  cases: import("./entities").Case[];
  tasks: import("./entities").Task[];
}
