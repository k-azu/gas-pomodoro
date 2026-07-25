import type { DocumentSearchFilter, DocumentSearchResult } from "../types/search";

const MOCK_DOCUMENTS: DocumentSearchResult[] = [
  {
    type: "memo",
    id: "mock-memo-1",
    title: "開発メモ",
    path: "メモ",
    snippet:
      "パフォーマンス計測の結果、IndexedDB（IDB）の読み込みがボトルネックになっている。getAll() を getByIndex() に変更して改善予定。",
    tags: ["dev"],
    isArchived: false,
    updatedAt: "2025-05-20T09:30:00.000Z",
  },
  {
    type: "memo",
    id: "mock-memo-2",
    title: "議事録",
    path: "メモ",
    snippet: "スプリントレビューと次スプリントの計画を確認。次回リリースは3月末を目標とする。",
    tags: ["meeting"],
    isArchived: false,
    updatedAt: "2025-05-19T01:00:00.000Z",
  },
  {
    type: "memo",
    id: "mock-memo-3",
    title: "設計ドキュメント",
    path: "メモ",
    snippet:
      "フロントエンドは React + TypeScript、バックエンドは Google Apps Script。検索機能は保存済み文書を対象とする。",
    tags: ["dev", "design"],
    isArchived: false,
    updatedAt: "2025-05-18T12:10:00.000Z",
  },
  {
    type: "memo",
    id: "mock-memo-4",
    title: "デプロイ手順書",
    path: "メモ",
    snippet:
      "pnpm run build:gas でビルド後、clasp push を実行し、スプレッドシートで動作を確認する。",
    tags: ["ops"],
    isArchived: false,
    updatedAt: "2025-05-14T03:45:00.000Z",
  },
  {
    type: "memo",
    id: "mock-memo-5",
    title: "バグトラッカー",
    path: "メモ",
    snippet: "未解決: タイマーが稀にリセットされる問題。再現条件とブラウザのログを収集中。",
    tags: ["bug"],
    isArchived: false,
    updatedAt: "2025-05-12T08:20:00.000Z",
  },
  {
    type: "memo",
    id: "mock-memo-archived",
    title: "旧バグトラッカー",
    path: "メモ",
    snippet: "解決済みのタイマー不具合と調査ログを保管したアーカイブです。",
    tags: ["bug"],
    isArchived: true,
    updatedAt: "2024-11-30T08:20:00.000Z",
  },
  {
    type: "task",
    id: "mock-task-1",
    title: "Phase 6: RecordForm実装",
    path: "GAS Pomodoro › React化",
    snippet: "作業記録フォームをReactへ移行する。カテゴリ選択とタスク紐付け、保存処理を実装する。",
    status: "doing",
    isArchived: false,
    updatedAt: "2025-05-21T02:15:00.000Z",
  },
  {
    type: "task",
    id: "mock-task-2",
    title: "タイマー表示のバグ",
    path: "GAS Pomodoro › バグ修正",
    snippet: "休憩から作業へ戻った際、タイマー表示が一瞬リセットされる。状態復元処理を調査する。",
    status: "review",
    isArchived: false,
    updatedAt: "2025-05-20T05:40:00.000Z",
  },
  {
    type: "task",
    id: "mock-task-3",
    title: "ドキュメント整備",
    path: "GAS Pomodoro",
    snippet: "検索機能の仕様とGAS側の検索API、フロントエンドの画面遷移についてREADMEへ追記する。",
    status: "docs",
    isArchived: false,
    updatedAt: "2025-05-17T07:00:00.000Z",
  },
  {
    type: "task",
    id: "mock-task-4",
    title: "ViewerPanel実装",
    path: "GAS Pomodoro › React化",
    snippet:
      "履歴の詳細表示と編集画面を実装する。関連タスクをクリックするとタスク文書へ移動できるようにする。",
    status: "done",
    isArchived: false,
    updatedAt: "2025-05-10T04:35:00.000Z",
  },
  {
    type: "task",
    id: "mock-task-5",
    title: "デザイン作成",
    path: "ポートフォリオ",
    snippet: "検索パレットのレイアウト、結果行のホバー状態、モバイル表示をデザインする。",
    status: "todo",
    isArchived: false,
    updatedAt: "2025-05-08T11:25:00.000Z",
  },
  {
    type: "task",
    id: "mock-task-7",
    title: "旧ビルド設定の削除",
    path: "GAS Pomodoro",
    snippet: "利用されていない旧ビルド設定を削除し、現在の構成へ一本化する。",
    status: "done",
    isArchived: true,
    updatedAt: "2024-12-15T00:00:00.000Z",
  },
];

function normalize(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("ja");
}

function scoreResult(result: DocumentSearchResult, tokens: string[]): number {
  if (tokens.length === 0) {
    return new Date(result.updatedAt).getTime();
  }

  const title = normalize(result.title);
  const path = normalize(result.path);
  const snippet = normalize(result.snippet);
  const tags = normalize((result.tags ?? []).join(" "));

  return tokens.reduce((score, token) => {
    if (title === token) return score + 100;
    if (title.startsWith(token)) return score + 60;
    if (title.includes(token)) return score + 40;
    if (tags.includes(token)) return score + 24;
    if (path.includes(token)) return score + 16;
    if (snippet.includes(token)) return score + 10;
    return score;
  }, 0);
}

export function searchMockDocuments(
  query: string,
  filter: DocumentSearchFilter,
): DocumentSearchResult[] {
  const tokens = normalize(query).trim().split(/\s+/).filter(Boolean);

  return MOCK_DOCUMENTS.filter((result) => filter === "all" || result.type === filter)
    .filter((result) => {
      if (tokens.length === 0) return true;
      const searchable = normalize(
        [
          result.title,
          result.path,
          result.snippet,
          ...(result.tags ?? []),
          result.status ?? "",
        ].join(" "),
      );
      return tokens.every((token) => searchable.includes(token));
    })
    .sort((a, b) => scoreResult(b, tokens) - scoreResult(a, tokens));
}

export function countMockDocumentsByType(query: string) {
  const results = searchMockDocuments(query, "all");
  return {
    all: results.length,
    memo: results.filter((result) => result.type === "memo").length,
    task: results.filter((result) => result.type === "task").length,
  };
}
