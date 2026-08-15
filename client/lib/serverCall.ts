/**
 * Promise wrapper for google.script.run
 * In dev mode (no google.script.run), returns mock data.
 */
import { countMockDocumentsByType, searchMockDocuments } from "./mockDocumentSearch";
import type { DocumentSearchFilter } from "../types/search";

declare global {
  interface Window {
    __mockDocumentSearchCallCount?: number;
    __mockServerCallCounts?: Record<string, number>;
    __mockContentShouldFail?: boolean;
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

const isDev = typeof window !== "undefined" && !window.google?.script?.run;
let serverCallHandlerForTests: ((functionName: string, args: unknown[]) => unknown) | null = null;

export function setServerCallHandlerForTests(
  handler: ((functionName: string, args: unknown[]) => unknown) | null,
): void {
  serverCallHandlerForTests = handler;
}

// =========================================================
// Mock scenario parameters (dev only)
// =========================================================

type MockScenario = "default" | "serverNewer" | "localNewer";

function readMockParams(): {
  scenario: MockScenario;
  delay: number;
  imageDelay: number;
  largeContent: boolean;
} {
  if (!isDev) return { scenario: "default", delay: 0, imageDelay: 0, largeContent: false };
  const params = new URLSearchParams(window.location.search);
  const raw = params.get("mockScenario") || "default";
  const scenario: MockScenario = raw === "serverNewer" || raw === "localNewer" ? raw : "default";
  const delay = Math.max(0, Number(params.get("mockDelay")) || 0);
  const imageDelay = Math.max(0, Number(params.get("mockImageDelay")) || 0);
  const largeContent = params.get("mockLargeContent") === "1";
  return { scenario, delay, imageDelay, largeContent };
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
    content: "機能Aの実装\n\n- エンドポイント追加\n- テスト作成",
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
    content: "コードレビュー\n\nPR #42 のレビュー",
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
    content: "バグ調査",
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
    content: "Slack で質問対応\n\nAPI仕様について確認",
  },
  {
    id: "mock-int-2",
    pomodoroId: "mock-rec-2",
    type: "nonWork",
    startTime: new Date(Date.now() - 6000000).toISOString(),
    endTime: new Date(Date.now() - 5880000).toISOString(),
    durationSeconds: 120,
    category: "緊急対応",
    content: "サーバーアラート確認",
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
    content: "# Pomodoro",
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-15T00:00:00.000Z",
  },
  {
    id: "mock-proj-2",
    name: "ポートフォリオ",
    color: "#34A853",
    sortOrder: 2,
    isActive: true,
    content: "# ポートフォリオ",
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
  {
    id: "mock-case-3",
    projectId: "mock-proj-1",
    name: "旧UIリファクタ",
    color: "#757575",
    sortOrder: 3,
    isActive: false,
    content: "",
    createdAt: "2024-12-01T00:00:00.000Z",
    updatedAt: "2025-01-10T00:00:00.000Z",
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
    _cachedPomodoroCount: 3,
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
    _cachedPomodoroCount: 1,
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
    _cachedPomodoroCount: 0,
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
    _cachedPomodoroCount: 5,
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
    _cachedPomodoroCount: 0,
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
    _cachedPomodoroCount: 0,
  },
  {
    id: "mock-task-7",
    projectId: "mock-proj-1",
    caseId: "",
    name: "旧ビルド設定の削除",
    status: "done",
    startedAt: "2024-12-10",
    dueDate: "",
    completedAt: "2024-12-15T00:00:00.000Z",
    sortOrder: 7,
    isActive: false,
    content: "",
    createdAt: "2024-12-10T00:00:00.000Z",
    updatedAt: "2024-12-15T00:00:00.000Z",
    _cachedTimeSeconds: 1800,
    _cachedPomodoroCount: 1,
  },
  {
    id: "mock-task-8",
    projectId: "mock-proj-1",
    caseId: "mock-case-3",
    name: "jQuery依存の除去",
    status: "done",
    startedAt: "2024-12-05",
    dueDate: "2024-12-20",
    completedAt: "2024-12-18T00:00:00.000Z",
    sortOrder: 8,
    isActive: false,
    content: "",
    createdAt: "2024-12-05T00:00:00.000Z",
    updatedAt: "2024-12-18T00:00:00.000Z",
    _cachedTimeSeconds: 3600,
    _cachedPomodoroCount: 2,
  },
  {
    id: "mock-task-9",
    projectId: "mock-proj-1",
    caseId: "mock-case-3",
    name: "レガシーCSS整理",
    status: "todo",
    startedAt: "",
    dueDate: "",
    completedAt: "",
    sortOrder: 9,
    isActive: false,
    content: "",
    createdAt: "2024-12-08T00:00:00.000Z",
    updatedAt: "2024-12-08T00:00:00.000Z",
    _cachedTimeSeconds: 0,
    _cachedPomodoroCount: 0,
  },
];

const MOCK_TASK_RECORDS = [
  {
    id: "mock-rec-1",
    type: "work",
    content: "機能Aの実装",
    actualDurationSeconds: 1500,
    startTime: new Date(Date.now() - 3600000).toISOString(),
    endTime: new Date(Date.now() - 2100000).toISOString(),
    category: "開発",
  },
  {
    id: "mock-rec-3",
    type: "work",
    content: "バグ調査",
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
  "updateRecordDetails",
  "updateInterruptionDetails",
  "putDocumentContent",
]);

/** Generate large mock content for char-count limit testing. Includes `prefix` for keyword matching. */
function generateLargeContent(charTarget: number, prefix: string): string {
  const block = [
    "## セクション",
    "",
    "これはダミーテキストです。文字数制限のテストのために生成されています。",
    "IndexedDB からスプレッドシートへの保存時、セルの上限は 50,000 文字です。",
    "",
    "- リスト項目 A: パフォーマンス計測の結果を記録する",
    "- リスト項目 B: エラーハンドリングの改善を検討する",
    "- リスト項目 C: テストカバレッジを向上させる",
    "",
  ].join("\n");
  let content = prefix + "\n\n";
  while (content.length < charTarget) {
    content += block;
  }
  return content;
}

/** Per-ID mock content (simulates server-side content for specific entities) */
const MOCK_CONTENT_BY_ID: Record<string, { content: string; updatedAt: string }> = {
  "mock-memo-1": {
    content: [
      "# 開発メモ",
      "",
      "## 今週のタスク",
      "",
      "- [x] ログイン画面のリファクタリング",
      "- [ ] APIエラーハンドリングの改善",
      "- [ ] E2Eテスト追加",
      "",
      "## メモ",
      "",
      "パフォーマンス計測の結果、**IDB読み込み**がボトルネックになっている。",
      "`getAll()` を `getByIndex()` に変更して改善予定。",
    ].join("\n"),
    updatedAt: "2025-01-15T00:00:00.000Z",
  },
  "mock-memo-2": {
    content: [
      "# 週次ミーティング 議事録",
      "",
      "**日時**: 2025-02-10 10:00-11:00",
      "",
      "## 参加者",
      "",
      "- 田中、佐藤、鈴木",
      "",
      "## 議題",
      "",
      "1. スプリントレビュー",
      "2. 次スプリントの計画",
      "",
      "## 決定事項",
      "",
      "> 次回リリースは3月末を目標とする",
    ].join("\n"),
    updatedAt: "2025-02-10T00:00:00.000Z",
  },
  "mock-memo-3": {
    content: [
      "# 設計ドキュメント",
      "",
      "## 概要",
      "",
      "このドキュメントはシステム設計の**要点**をまとめたものです。",
      "",
      "## アーキテクチャ",
      "",
      "- フロントエンド: React + TypeScript",
      "- バックエンド: Google Apps Script",
      "- データストア: Spreadsheet + IndexedDB (オフラインキャッシュ)",
      "",
      "## TODO",
      "",
      "1. パフォーマンス改善",
      "2. エラーハンドリング強化",
      "3. テストカバレッジ向上",
    ].join("\n"),
    updatedAt: "2025-03-01T00:00:00.000Z",
  },
  "mock-memo-4": {
    content: [
      "# デプロイ手順書",
      "",
      "## 前提条件",
      "",
      "- Node.js 20以上",
      "- clasp がインストール済み",
      "",
      "## 手順",
      "",
      "1. `npm run build` でビルド",
      "2. `clasp push` でデプロイ",
      "3. スプレッドシートで動作確認",
    ].join("\n"),
    updatedAt: "2025-04-01T00:00:00.000Z",
  },
  "mock-memo-5": {
    content: generateLargeContent(
      51000,
      "# バグトラッカー\n\n## 未解決\n\n- タイマーが稀にリセットされる問題",
    ),
    updatedAt: "2025-05-01T00:00:00.000Z",
  },
  "mock-memo-empty": {
    content: "",
    updatedAt: "2025-06-01T00:00:00.000Z",
  },
  "mock-memo-archived": {
    content: "# 旧バグトラッカー\n\n解決済みのタイマー不具合と調査ログです。",
    updatedAt: "2024-11-30T08:20:00.000Z",
  },
};

const mockContentRevision = new Map<string, number>();
const mockMetadataRevision = new Map<string, number>();
const mockLastContentMutation = new Map<string, string>();
const mockLastMetadataMutation = new Map<string, string>();
const mockMetadataOverrides = new Map<string, Record<string, unknown>>();
const MOCK_SERVER_STORAGE_KEY = "gas-pomodoro:mock-document-server:v1";

interface MockDocumentServerState {
  content?: string;
  updatedAt?: string;
  contentRevision?: number;
  metadataRevision?: number;
  lastContentMutationId?: string;
  lastMetadataMutationId?: string;
  metadata?: Record<string, unknown>;
}

function readMockServerStates(): Record<string, MockDocumentServerState> {
  if (!isDev) return {};
  try {
    return JSON.parse(localStorage.getItem(MOCK_SERVER_STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function readMockServerState(id: string): MockDocumentServerState {
  return readMockServerStates()[id] ?? {};
}

function writeMockServerState(id: string, patch: MockDocumentServerState): void {
  const states = readMockServerStates();
  states[id] = { ...(states[id] ?? {}), ...patch };
  localStorage.setItem(MOCK_SERVER_STORAGE_KEY, JSON.stringify(states));
}

export function setMockRemoteDocumentContentForTests(id: string, content: string): void {
  if (!isDev) return;
  const state = readMockServerState(id);
  const revision = (state.contentRevision ?? mockContentRevision.get(id) ?? 0) + 1;
  const updatedAt = new Date().toISOString();
  const lastContentMutationId = `remote-${crypto.randomUUID()}`;
  mockContentRevision.set(id, revision);
  mockLastContentMutation.set(id, lastContentMutationId);
  MOCK_CONTENT_BY_ID[id] = { content, updatedAt };
  writeMockServerState(id, {
    content,
    updatedAt,
    contentRevision: revision,
    lastContentMutationId,
  });
}

function withDocumentSyncFields<T extends { id: string; updatedAt: string }>(entities: T[]) {
  return entities.map((entity) => {
    const state = readMockServerState(entity.id);
    const contentOverride =
      entity.id === "mock-memo-1" &&
      typeof window !== "undefined" &&
      (window as any).__mockContentOverride &&
      typeof (window as any).__mockContentOverride.content === "string"
        ? ((window as any).__mockContentOverride as { content: string; updatedAt?: string })
        : null;
    return {
      ...entity,
      ...(mockMetadataOverrides.get(entity.id) ?? {}),
      ...(state.metadata ?? {}),
      updatedAt: contentOverride?.updatedAt ?? state.updatedAt ?? entity.updatedAt,
      content:
        contentOverride?.content ?? state.content ?? MOCK_CONTENT_BY_ID[entity.id]?.content ?? "",
      contentRevision: state.contentRevision ?? mockContentRevision.get(entity.id) ?? 0,
      metadataRevision: state.metadataRevision ?? mockMetadataRevision.get(entity.id) ?? 0,
      lastContentMutationId:
        state.lastContentMutationId ?? mockLastContentMutation.get(entity.id) ?? "",
      lastMetadataMutationId:
        state.lastMetadataMutationId ?? mockLastMetadataMutation.get(entity.id) ?? "",
    };
  });
}

function getContentMockResponse(functionName: string, id?: string): unknown {
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
  // Normal documents return their server content regardless of response delay.
  if (id && MOCK_CONTENT_BY_ID[id]) {
    const state = readMockServerState(id);
    return {
      content: state.content ?? MOCK_CONTENT_BY_ID[id].content,
      updatedAt: state.updatedAt ?? MOCK_CONTENT_BY_ID[id].updatedAt,
    };
  }
  // An unknown ID represents a record that no longer exists on the server.
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
        recentRecordsBulk: MOCK_RECORDS,
        recentInterruptionsBulk: MOCK_INTERRUPTIONS,
        spreadsheetUrl: "https://docs.google.com/spreadsheets/d/example",
        webAppUrl: `${window.location.origin}/`,
        memos: withDocumentSyncFields([
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
          {
            id: "mock-memo-3",
            name: "設計ドキュメント",
            tags: ["dev"],
            sortOrder: 3,
            isActive: true,
            createdAt: "2025-03-01T00:00:00.000Z",
            updatedAt: "2025-03-01T00:00:00.000Z",
          },
          {
            id: "mock-memo-4",
            name: "デプロイ手順書",
            tags: [],
            sortOrder: 4,
            isActive: true,
            createdAt: "2025-04-01T00:00:00.000Z",
            updatedAt: "2025-04-01T00:00:00.000Z",
          },
          {
            id: "mock-memo-5",
            name: "バグトラッカー",
            tags: [],
            sortOrder: 5,
            isActive: true,
            createdAt: "2025-05-01T00:00:00.000Z",
            updatedAt: "2025-05-01T00:00:00.000Z",
          },
          {
            id: "mock-memo-empty",
            name: "空のメモ",
            tags: [],
            sortOrder: 6,
            isActive: true,
            createdAt: "2025-06-01T00:00:00.000Z",
            updatedAt: "2025-06-01T00:00:00.000Z",
          },
        ]),
        memoTags: [
          { name: "dev", color: "#4CAF50", sortOrder: 1, isActive: true },
          { name: "memo", color: "#2196F3", sortOrder: 2, isActive: true },
        ],
        projects: withDocumentSyncFields(MOCK_PROJECTS),
        cases: withDocumentSyncFields(MOCK_CASES),
        tasks: withDocumentSyncFields(MOCK_TASKS),
      };

    case "getAllDocumentData": {
      const initial = getMockResponse("getAllInitData", []) as {
        memos: unknown[];
        projects: unknown[];
        cases: unknown[];
        tasks: unknown[];
      };
      return {
        memos: initial.memos,
        projects: initial.projects,
        cases: initial.cases,
        tasks: initial.tasks,
      };
    }

    case "getDocumentViewInitData": {
      const initial = getMockResponse("getAllInitData", []) as Record<string, unknown> & {
        memos: Array<{ id: string }>;
        projects: Array<{ id: string }>;
        cases: Array<{ id: string }>;
        tasks: Array<{ id: string }>;
      };
      const documentKey = String(args[0]);
      const [storeName, id] = documentKey.split(":");
      const selectedMemos =
        storeName !== "memos"
          ? []
          : initial.memos.filter((entity) => entity.id === id).length > 0
            ? initial.memos.filter((entity) => entity.id === id)
            : id === "mock-memo-archived"
              ? withDocumentSyncFields([
                  {
                    id,
                    name: "アーカイブ済みメモ",
                    tags: ["memo"],
                    sortOrder: 99,
                    isActive: false,
                    createdAt: "2024-11-01T00:00:00.000Z",
                    updatedAt: "2024-11-30T08:20:00.000Z",
                  },
                ])
              : [];
      return {
        ...initial,
        recentRecordsBulk: [],
        recentInterruptionsBulk: [],
        memos: selectedMemos,
        projects:
          storeName === "projects" ? initial.projects.filter((entity) => entity.id === id) : [],
        cases: storeName === "cases" ? initial.cases.filter((entity) => entity.id === id) : [],
        tasks: storeName === "tasks" ? initial.tasks.filter((entity) => entity.id === id) : [],
      };
    }

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

    case "searchDocuments": {
      window.__mockDocumentSearchCallCount = (window.__mockDocumentSearchCallCount ?? 0) + 1;
      const query = String(args[0] || "");
      const requestedFilter = String(args[1] || "all");
      const filter: DocumentSearchFilter =
        requestedFilter === "memo" || requestedFilter === "task" ? requestedFilter : "all";
      const requestedLimit = Number(args[2]);
      const limit = Number.isFinite(requestedLimit) ? Math.max(1, requestedLimit) : 50;
      return {
        results: searchMockDocuments(query, filter).slice(0, limit),
        counts: countMockDocumentsByType(query),
      };
    }

    // ---- Record CRUD ----
    case "saveRecord":
      return { success: true, record: args[0] };

    case "saveInterruptions":
      return { success: true };

    case "getLastWorkRecord":
      return MOCK_RECORDS[0] || null;

    case "updateRecordContent":
    case "updateRecordCategory":
    case "updateRecordTimes":
    case "updateRecordTaskId":
      return { success: true, record: MOCK_RECORDS[0] };
    case "updateRecordDetails": {
      const id = String(args[0]);
      const update = (args[1] || {}) as any;
      const original = MOCK_RECORDS.find((record) => record.id === id) || MOCK_RECORDS[0];
      return {
        success: true,
        record: {
          ...original,
          content: update.content,
          category: update.category,
          startTime: update.startTime,
          endTime: update.endTime,
          projectId: update.projectId,
          caseId: update.caseId,
          taskId: update.taskId,
        },
      };
    }

    // ---- Interruption CRUD ----
    case "updateInterruptionContent":
    case "updateInterruptionCategory":
    case "updateInterruptionType":
    case "updateInterruptionTimes":
      return { success: true, interruption: MOCK_INTERRUPTIONS[0] };
    case "updateInterruptionDetails": {
      const id = String(args[0]);
      const update = (args[1] || {}) as any;
      const original =
        MOCK_INTERRUPTIONS.find((interruption) => interruption.id === id) || MOCK_INTERRUPTIONS[0];
      return {
        success: true,
        interruption: {
          ...original,
          content: update.content,
          category: update.category,
          type: update.interruptionType,
          startTime: update.startTime,
          endTime: update.endTime,
        },
      };
    }

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

    case "putDocumentContent": {
      const request = args[0] as {
        documentKey: string;
        content: string;
        expectedRevision: number;
        mutationId: string;
      };
      const id = request.documentKey.slice(request.documentKey.indexOf(":") + 1);
      const state = readMockServerState(id);
      const currentRevision = state.contentRevision ?? mockContentRevision.get(id) ?? 0;
      const currentContent = state.content ?? MOCK_CONTENT_BY_ID[id]?.content ?? "";
      const updatedAt =
        state.updatedAt ?? MOCK_CONTENT_BY_ID[id]?.updatedAt ?? new Date().toISOString();
      const snapshot = {
        documentKey: request.documentKey,
        content: currentContent,
        revision: currentRevision,
        updatedAt,
        lastMutationId: state.lastContentMutationId ?? mockLastContentMutation.get(id) ?? "",
      };
      if (snapshot.lastMutationId === request.mutationId) {
        return { status: "applied", mutationId: request.mutationId, snapshot };
      }
      if (request.expectedRevision !== currentRevision) {
        return { status: "conflict", mutationId: request.mutationId, snapshot };
      }
      const nextRevision = currentRevision + 1;
      const nextUpdatedAt = new Date().toISOString();
      mockContentRevision.set(id, nextRevision);
      mockLastContentMutation.set(id, request.mutationId);
      MOCK_CONTENT_BY_ID[id] = { content: request.content, updatedAt: nextUpdatedAt };
      writeMockServerState(id, {
        content: request.content,
        updatedAt: nextUpdatedAt,
        contentRevision: nextRevision,
        lastContentMutationId: request.mutationId,
      });
      return {
        status: "applied",
        mutationId: request.mutationId,
        snapshot: {
          documentKey: request.documentKey,
          content: request.content,
          revision: nextRevision,
          updatedAt: nextUpdatedAt,
          lastMutationId: request.mutationId,
        },
      };
    }

    case "patchDocumentMetadata": {
      const request = args[0] as {
        documentKey: string;
        patch: Record<string, unknown>;
        expectedRevision: number;
        mutationId: string;
      };
      const id = request.documentKey.slice(request.documentKey.indexOf(":") + 1);
      const state = readMockServerState(id);
      const currentRevision = state.metadataRevision ?? mockMetadataRevision.get(id) ?? 0;
      const lastMutationId = state.lastMetadataMutationId ?? mockLastMetadataMutation.get(id) ?? "";
      const initial = getMockResponse("getAllInitData", []) as {
        memos: Array<Record<string, unknown>>;
        projects: Array<Record<string, unknown>>;
        cases: Array<Record<string, unknown>>;
        tasks: Array<Record<string, unknown>>;
      };
      const storeName = request.documentKey.slice(0, request.documentKey.indexOf(":"));
      const collection =
        storeName === "memos"
          ? initial.memos
          : storeName === "projects"
            ? initial.projects
            : storeName === "cases"
              ? initial.cases
              : initial.tasks;
      const currentEntity = collection.find((entity) => entity.id === id) ?? {};
      const fields =
        storeName === "memos"
          ? ["name", "tags", "isActive"]
          : storeName === "projects"
            ? ["name", "color", "isActive"]
            : storeName === "cases"
              ? ["projectId", "name", "isActive"]
              : [
                  "projectId",
                  "caseId",
                  "name",
                  "status",
                  "isActive",
                  "startedAt",
                  "dueDate",
                  "completedAt",
                ];
      const currentMetadata = Object.fromEntries(
        fields.map((field) => [field, currentEntity[field]]),
      );
      const snapshot = {
        documentKey: request.documentKey,
        revision: currentRevision,
        updatedAt: new Date().toISOString(),
        lastMutationId,
        metadata: currentMetadata,
      };
      if (lastMutationId === request.mutationId) {
        return { status: "applied", mutationId: request.mutationId, snapshot };
      }
      if (request.expectedRevision !== currentRevision) {
        return { status: "conflict", mutationId: request.mutationId, snapshot };
      }
      const nextRevision = currentRevision + 1;
      const updatedAt = new Date().toISOString();
      mockMetadataRevision.set(id, nextRevision);
      mockLastMetadataMutation.set(id, request.mutationId);
      mockMetadataOverrides.set(id, {
        ...(mockMetadataOverrides.get(id) ?? {}),
        ...request.patch,
        updatedAt,
      });
      writeMockServerState(id, {
        updatedAt,
        metadataRevision: nextRevision,
        lastMetadataMutationId: request.mutationId,
        metadata: {
          ...(state.metadata ?? {}),
          ...request.patch,
        },
      });
      return {
        status: "applied",
        mutationId: request.mutationId,
        snapshot: {
          ...snapshot,
          revision: nextRevision,
          updatedAt,
          lastMutationId: request.mutationId,
          metadata: { ...currentMetadata, ...request.patch },
        },
      };
    }

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
      return getContentMockResponse(functionName, args[0] as string);

    // ---- Memo ----
    case "getMemoContent":
      return getContentMockResponse(functionName, args[0] as string);

    case "saveMemoContent":
    case "renameMemo":
    case "updateMemoTags":
    case "addMemoTag":
    case "updateMemoTagColor":
      return { success: true };

    // ---- Link resolve ----
    case "resolveLink": {
      const url = args[0] as string;
      try {
        const hostname = new URL(url).hostname;
        return { title: hostname };
      } catch {
        return {};
      }
    }

    // ---- Image ----
    case "getImageBase64":
      return {
        base64:
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
        mimeType: "image/png",
      };

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
  if (serverCallHandlerForTests) {
    return Promise.resolve().then(() => serverCallHandlerForTests!(functionName, args));
  }
  if (isDev) {
    console.log(`[mock] serverCall: ${functionName}`, args);
    window.__mockServerCallCounts = window.__mockServerCallCounts ?? {};
    window.__mockServerCallCounts[functionName] =
      (window.__mockServerCallCounts[functionName] ?? 0) + 1;
    const baseDelay = 100;
    const extraDelay = CONTENT_FUNCTIONS.has(functionName)
      ? mockParams.delay
      : functionName === "getImageBase64"
        ? mockParams.imageDelay
        : 0;

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
