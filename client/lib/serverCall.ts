/**
 * Promise wrapper for google.script.run
 * In dev mode (no google.script.run), returns mock data.
 */

declare global {
  interface Window {
    google?: {
      script: {
        run: {
          withSuccessHandler: (cb: (result: unknown) => void) => {
            withFailureHandler: (
              cb: (error: Error) => void,
            ) => Record<string, (...args: unknown[]) => void>;
          };
        };
      };
    };
  }
}

const isDev = !window.google?.script?.run;

// =========================================================
// Mock scenario parameters (dev only)
// =========================================================

type MockScenario = "default" | "serverNewer" | "localNewer";

function readMockParams(): { scenario: MockScenario; delay: number } {
  if (!isDev) return { scenario: "default", delay: 0 };
  const params = new URLSearchParams(window.location.search);
  const raw = params.get("mockScenario") || "default";
  const scenario: MockScenario = raw === "serverNewer" || raw === "localNewer" ? raw : "default";
  const delay = Math.max(0, Number(params.get("mockDelay")) || 0);
  return { scenario, delay };
}

const mockParams = readMockParams();

// =========================================================
// Mock data helpers
// =========================================================

function formatDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const TODAY = formatDate(new Date());

const MOCK_CATEGORIES = [
  { name: "開発", color: "#4CAF50", sortOrder: 0, isActive: true },
  { name: "レビュー", color: "#2196F3", sortOrder: 1, isActive: true },
  { name: "ミーティング", color: "#FF9800", sortOrder: 2, isActive: true },
];

const MOCK_INT_CATEGORIES = [
  { name: "質問", color: "#9C27B0", sortOrder: 0, isActive: true },
  { name: "緊急対応", color: "#F44336", sortOrder: 1, isActive: true },
];

const MOCK_RECORDS = [
  {
    id: "mock-rec-1",
    date: TODAY,
    startTime: new Date(Date.now() - 3600000).toISOString(),
    endTime: new Date(Date.now() - 2100000).toISOString(),
    durationSeconds: 1500,
    actualDurationSeconds: 1500,
    type: "work",
    description: "機能Aの実装\n\n- エンドポイント追加\n- テスト作成",
    category: "開発",
    workInterruptions: 1,
    nonWorkInterruptions: 0,
    workInterruptionSeconds: 60,
    nonWorkInterruptionSeconds: 0,
    completionStatus: "completed",
    pomodoroSetIndex: 1,
    taskId: "mock-task-1",
  },
  {
    id: "mock-rec-2",
    date: TODAY,
    startTime: new Date(Date.now() - 7200000).toISOString(),
    endTime: new Date(Date.now() - 5700000).toISOString(),
    durationSeconds: 1500,
    actualDurationSeconds: 1500,
    type: "work",
    description: "コードレビュー\n\nPR #42 のレビュー",
    category: "レビュー",
    workInterruptions: 0,
    nonWorkInterruptions: 1,
    workInterruptionSeconds: 0,
    nonWorkInterruptionSeconds: 120,
    completionStatus: "completed",
    pomodoroSetIndex: 2,
    taskId: "",
  },
  {
    id: "mock-rec-3",
    date: TODAY,
    startTime: new Date(Date.now() - 10800000).toISOString(),
    endTime: new Date(Date.now() - 9300000).toISOString(),
    durationSeconds: 1500,
    actualDurationSeconds: 900,
    type: "work",
    description: "バグ調査",
    category: "開発",
    workInterruptions: 0,
    nonWorkInterruptions: 0,
    workInterruptionSeconds: 0,
    nonWorkInterruptionSeconds: 0,
    completionStatus: "abandoned",
    pomodoroSetIndex: 3,
    taskId: "mock-task-2",
  },
];

const MOCK_INTERRUPTIONS = [
  {
    id: "mock-int-1",
    pomodoroId: "mock-rec-1",
    type: "work",
    startTime: new Date(Date.now() - 3000000).toISOString(),
    endTime: new Date(Date.now() - 2940000).toISOString(),
    durationSeconds: 60,
    category: "質問",
    note: "Slack で質問対応\n\nAPI仕様について確認",
  },
  {
    id: "mock-int-2",
    pomodoroId: "mock-rec-2",
    type: "nonWork",
    startTime: new Date(Date.now() - 6000000).toISOString(),
    endTime: new Date(Date.now() - 5880000).toISOString(),
    durationSeconds: 120,
    category: "緊急対応",
    note: "サーバーアラート確認",
  },
];

const MOCK_STATS = {
  completedPomodoros: 2,
  abandonedPomodoros: 1,
  totalWorkSeconds: 3900,
  totalBreakSeconds: 600,
  totalWorkInterruptionSeconds: 60,
  totalNonWorkInterruptionSeconds: 120,
};

const MOCK_PROJECTS = [
  {
    id: "mock-proj-1",
    name: "GAS Pomodoro",
    color: "#4285f4",
    sortOrder: 1,
    isActive: true,
    content: "",
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-15T00:00:00.000Z",
  },
  {
    id: "mock-proj-2",
    name: "ポートフォリオ",
    color: "#34A853",
    sortOrder: 2,
    isActive: true,
    content: "",
    createdAt: "2025-02-01T00:00:00.000Z",
    updatedAt: "2025-02-10T00:00:00.000Z",
  },
];

const MOCK_CASES = [
  {
    id: "mock-case-1",
    projectId: "mock-proj-1",
    name: "React化",
    color: "#757575",
    sortOrder: 1,
    isActive: true,
    content: "",
    createdAt: "2025-01-05T00:00:00.000Z",
    updatedAt: "2025-01-20T00:00:00.000Z",
  },
  {
    id: "mock-case-2",
    projectId: "mock-proj-1",
    name: "バグ修正",
    color: "#757575",
    sortOrder: 2,
    isActive: true,
    content: "",
    createdAt: "2025-01-10T00:00:00.000Z",
    updatedAt: "2025-01-25T00:00:00.000Z",
  },
];

const MOCK_TASKS = [
  {
    id: "mock-task-1",
    projectId: "mock-proj-1",
    caseId: "mock-case-1",
    name: "Phase 6: RecordForm実装",
    status: "doing",
    startedAt: "2025-01-20",
    dueDate: "2025-02-01",
    completedAt: "",
    sortOrder: 1,
    isActive: true,
    content: "",
    createdAt: "2025-01-20T00:00:00.000Z",
    updatedAt: "2025-01-25T00:00:00.000Z",
    _cachedTimeSeconds: 5400,
  },
  {
    id: "mock-task-2",
    projectId: "mock-proj-1",
    caseId: "mock-case-2",
    name: "タイマー表示のバグ",
    status: "review",
    startedAt: "2025-01-22",
    dueDate: "",
    completedAt: "",
    sortOrder: 2,
    isActive: true,
    content: "",
    createdAt: "2025-01-22T00:00:00.000Z",
    updatedAt: "2025-01-26T00:00:00.000Z",
    _cachedTimeSeconds: 900,
  },
  {
    id: "mock-task-3",
    projectId: "mock-proj-1",
    caseId: "",
    name: "ドキュメント整備",
    status: "docs",
    startedAt: "",
    dueDate: "",
    completedAt: "",
    sortOrder: 3,
    isActive: true,
    content: "",
    createdAt: "2025-01-25T00:00:00.000Z",
    updatedAt: "2025-01-25T00:00:00.000Z",
    _cachedTimeSeconds: 0,
  },
  {
    id: "mock-task-4",
    projectId: "mock-proj-1",
    caseId: "mock-case-1",
    name: "ViewerPanel実装",
    status: "done",
    startedAt: "2025-01-15",
    dueDate: "2025-01-20",
    completedAt: "2025-01-19T00:00:00.000Z",
    sortOrder: 4,
    isActive: true,
    content: "",
    createdAt: "2025-01-15T00:00:00.000Z",
    updatedAt: "2025-01-19T00:00:00.000Z",
    _cachedTimeSeconds: 7200,
  },
  {
    id: "mock-task-5",
    projectId: "mock-proj-2",
    caseId: "",
    name: "デザイン作成",
    status: "todo",
    startedAt: "",
    dueDate: "2025-03-01",
    completedAt: "",
    sortOrder: 1,
    isActive: true,
    content: "",
    createdAt: "2025-02-01T00:00:00.000Z",
    updatedAt: "2025-02-01T00:00:00.000Z",
    _cachedTimeSeconds: 0,
  },
  {
    id: "mock-task-6",
    projectId: "mock-proj-2",
    caseId: "",
    name: "CI/CD構築",
    status: "pending",
    startedAt: "",
    dueDate: "",
    completedAt: "",
    sortOrder: 2,
    isActive: true,
    content: "",
    createdAt: "2025-02-05T00:00:00.000Z",
    updatedAt: "2025-02-05T00:00:00.000Z",
    _cachedTimeSeconds: 0,
  },
];

const MOCK_TASK_RECORDS = [
  {
    id: "mock-rec-1",
    type: "work",
    description: "機能Aの実装",
    actualDurationSeconds: 1500,
    startTime: new Date(Date.now() - 3600000).toISOString(),
    endTime: new Date(Date.now() - 2100000).toISOString(),
    category: "開発",
  },
  {
    id: "mock-rec-3",
    type: "work",
    description: "バグ調査",
    actualDurationSeconds: 900,
    startTime: new Date(Date.now() - 10800000).toISOString(),
    endTime: new Date(Date.now() - 9300000).toISOString(),
    category: "開発",
  },
];

// =========================================================
// Content-function names that support scenario + extra delay
// =========================================================

const CONTENT_FUNCTIONS = new Set([
  "getProjectContent",
  "getCaseContent",
  "getTaskContent",
  "getMemoContent",
]);

function getContentMockResponse(functionName: string): unknown {
  if (typeof window !== "undefined" && (window as any).__mockContentOverride !== undefined) {
    return (window as any).__mockContentOverride;
  }
  const { scenario } = mockParams;
  if (scenario === "serverNewer") {
    return {
      content: `# サーバーから取得 (${functionName})\n\nこのコンテンツはサーバー側で更新されました。\n\n更新日時: ${new Date().toISOString()}`,
      updatedAt: new Date().toISOString(),
    };
  }
  if (scenario === "localNewer") {
    // Server returns old content — resolveWithServer should keep local
    return {
      content: "",
      updatedAt: new Date(Date.now() - 86400000).toISOString(), // 1 day ago
    };
  }
  // default — server has no content data (null triggers "keep local" path in resolveContentConflict)
  return null;
}

// =========================================================
// Mock handler — returns data based on function name
// =========================================================

function getMockResponse(functionName: string, args: unknown[]): unknown {
  switch (functionName) {
    // ---- Init / Refresh ----
    case "getAllInitData":
      return {
        timerConfigs: [
          {
            patternName: "Standard",
            workMinutes: 25,
            shortBreakMinutes: 5,
            longBreakMinutes: 15,
            pomodorosBeforeLongBreak: 4,
            isActive: true,
          },
          {
            patternName: "Short",
            workMinutes: 15,
            shortBreakMinutes: 3,
            longBreakMinutes: 10,
            pomodorosBeforeLongBreak: 4,
            isActive: false,
          },
        ],
        categories: MOCK_CATEGORIES,
        interruptionCategories: MOCK_INT_CATEGORIES,
        todayStats: MOCK_STATS,
        recentRecords: MOCK_RECORDS,
        todayInterruptions: MOCK_INTERRUPTIONS,
        spreadsheetUrl: "https://docs.google.com/spreadsheets/d/example",
        memos: [
          {
            id: "mock-memo-1",
            name: "開発メモ",
            tags: ["dev"],
            sortOrder: 1,
            isActive: true,
            createdAt: "2025-01-01T00:00:00.000Z",
            updatedAt: "2025-01-15T00:00:00.000Z",
          },
          {
            id: "mock-memo-2",
            name: "議事録",
            tags: [],
            sortOrder: 2,
            isActive: true,
            createdAt: "2025-02-01T00:00:00.000Z",
            updatedAt: "2025-02-10T00:00:00.000Z",
          },
        ],
        memoTags: [
          { name: "dev", color: "#4CAF50", sortOrder: 1, isActive: true },
          { name: "memo", color: "#2196F3", sortOrder: 2, isActive: true },
        ],
        projects: MOCK_PROJECTS,
        cases: MOCK_CASES,
        tasks: MOCK_TASKS,
      };

    case "getRefreshData":
      return {
        todayStats: MOCK_STATS,
        recentRecords: MOCK_RECORDS,
        todayInterruptions: MOCK_INTERRUPTIONS,
      };

    case "getDataForDate":
      return {
        todayStats: {
          completedPomodoros: 2,
          abandonedPomodoros: 0,
          totalWorkSeconds: 3000,
          totalBreakSeconds: 600,
          totalWorkInterruptionSeconds: 0,
          totalNonWorkInterruptionSeconds: 0,
        },
        recentRecords: MOCK_RECORDS.slice(0, 2),
        todayInterruptions: MOCK_INTERRUPTIONS.slice(0, 1),
      };

    case "getWeekRecordCounts": {
      const counts: Record<string, number> = {};
      const today = new Date();
      for (let i = 0; i < 7; i++) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        counts[formatDate(d)] = i === 0 ? 3 : Math.floor(Math.random() * 5);
      }
      return counts;
    }

    // ---- Record CRUD ----
    case "saveRecord":
      return { success: true };

    case "saveInterruptions":
      return { success: true };

    case "getLastWorkRecord":
      return MOCK_RECORDS[0] || null;

    case "updateRecordDescription":
    case "updateRecordCategory":
    case "updateRecordTimes":
    case "updateRecordTaskId":
      return { success: true };

    // ---- Interruption CRUD ----
    case "updateInterruptionNote":
    case "updateInterruptionCategory":
    case "updateInterruptionType":
    case "updateInterruptionTimes":
      return { success: true };

    // ---- Category CRUD ----
    case "getCategories":
      return MOCK_CATEGORIES;

    case "getInterruptionCategories":
      return MOCK_INT_CATEGORIES;

    case "addCategory":
    case "addInterruptionCategory":
      return { success: true };

    case "updateCategoryColor":
      return { success: true };

    // ---- Timer Config ----
    case "getAllTimerConfigs":
      return [
        {
          patternName: "Standard",
          workMinutes: 25,
          shortBreakMinutes: 5,
          longBreakMinutes: 15,
          pomodorosBeforeLongBreak: 4,
          isActive: true,
        },
      ];

    // ---- Task Data ----
    case "getAllTaskData":
      return {
        projects: MOCK_PROJECTS,
        cases: MOCK_CASES,
        tasks: MOCK_TASKS,
      };

    case "getTaskPomodoroRecords":
      return MOCK_TASK_RECORDS;

    // ---- EntityStore dynamic server functions ----
    case "addProject":
    case "addCase":
    case "addTask":
      return { success: true };

    case "updateProject":
    case "updateCase":
    case "updateTask":
      return { success: true };

    case "archiveProject":
    case "archiveCase":
    case "archiveTask":
      return { success: true };

    case "reorderProjects":
    case "reorderCases":
    case "reorderTasks":
      return { success: true };

    case "getProjectContent":
    case "getCaseContent":
    case "getTaskContent":
      return getContentMockResponse(functionName);

    // ---- Memo ----
    case "getMemoContent":
      return getContentMockResponse(functionName);

    case "saveMemoContent":
    case "renameMemo":
    case "updateMemoTags":
    case "addMemoTag":
    case "updateMemoTagColor":
      return { success: true };

    // ---- Image ----
    case "getImageBase64":
      return null;

    case "uploadImage":
      return { url: "https://example.com/mock-image.png" };

    default:
      console.warn(`[mock] Unknown serverCall: ${functionName}`, args);
      return null;
  }
}

// =========================================================
// Public API
// =========================================================

export function serverCall(functionName: string, ...args: unknown[]): Promise<unknown> {
  if (isDev) {
    console.log(`[mock] serverCall: ${functionName}`, args);
    const baseDelay = 100;
    const extraDelay = CONTENT_FUNCTIONS.has(functionName) ? mockParams.delay : 0;

    if (CONTENT_FUNCTIONS.has(functionName) && (window as any).__mockContentShouldFail) {
      return new Promise((_, reject) => {
        setTimeout(() => reject(new Error("Mock: forced content error")), baseDelay);
      });
    }

    return new Promise((resolve) => {
      setTimeout(() => {
        const result = getMockResponse(functionName, args);
        resolve(result);
      }, baseDelay + extraDelay);
    });
  }

  return new Promise((resolve, reject) => {
    const runner = window.google!.script.run.withSuccessHandler(resolve).withFailureHandler(reject);
    const fn = runner[functionName];
    if (typeof fn !== "function") {
      reject(new Error(`Server function not found: ${functionName}`));
      return;
    }
    fn(...args);
  });
}
