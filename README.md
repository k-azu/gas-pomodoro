# gas-pomodoro

Google Apps Script + Spreadsheet で動くポモドーロタイマー。

## アーキテクチャ

```
client/          React クライアントアプリ (Vite + TypeScript)
src/             GAS サーバーサイド (clasp push 対象)
scripts/         ビルドスクリプト
```

- **クライアント**: `client/` 配下の React アプリを Vite で IIFE バンドルにビルドし、`src/ClientBundle.html` として GAS に配信
- **React**: esbuild で別途バンドルし `src/ReactVendor.html` として分離配信
- **エディタ**: [tiptap-markdown-editor](https://tiptap-markdown-editor.pages.dev/) を CDN から読み込み（ローカルにリポジトリがあれば自動で link 解決）
- **サーバー**: `src/*.ts` を clasp が GAS にトランスパイル

## セットアップ

### 前提条件

- Node.js
- [pnpm](https://pnpm.io/installation)（`corepack enable` で自動インストール可能）
- Google アカウント

### 1. 依存パッケージのインストール

```bash
pnpm install
```

> **Note**: このプロジェクトは pnpm を強制しています。`npm install` や `yarn` は実行できません。

### 2. clasp にログイン

```bash
pnpm run login
```

ブラウザが開くので Google アカウントで認証する。

### 3. GAS プロジェクトの作成

**新規作成する場合:**

```bash
pnpm exec clasp create --type sheets --rootDir src/ --title "Pomodoro Timer"
mv src/.clasp.json .clasp.json
```

`clasp create` は `.clasp.json` を `src/` 内に生成するため、プロジェクトルートに移動する必要がある。

**既存の GAS プロジェクトに接続する場合:**

`.clasp.json` を手動で作成:

```json
{
  "scriptId": "<GASプロジェクトのスクリプトID>",
  "rootDir": "src/"
}
```

スクリプトIDは GAS エディタの「プロジェクトの設定」から確認できる。

### 4. デプロイ

```bash
pnpm run deploy
```

初回プッシュでシート（PomodoroLog, Categories, TimerConfig 等）が自動作成される。

### 5. Web アプリとして公開

1. `pnpm run open` で GAS エディタを開く
2. 「デプロイ」→「新しいデプロイ」
3. 種類：「ウェブアプリ」を選択
4. 次のユーザーとして実行：「自分」
5. アクセスできるユーザー：「自分のみ」
6. 「デプロイ」をクリック
7. 初回は権限の承認が必要 — 「詳細」→「(プロジェクト名)に移動」で許可

デプロイ後に表示される URL でタイマーにアクセスできる。

## エディタ (tiptap-markdown-editor)

リッチテキストエディタとして [tiptap-markdown-editor](https://tiptap-markdown-editor.pages.dev/) を使用。

| 状況 | 解決方法 |
|------|----------|
| `../tiptap-markdown-editor` がローカルにある | Vite がローカルから解決（HMR・フル型サポート） |
| ローカルにない（一般利用者） | CDN から自動読み込み（フォールバック型定義で typecheck も通る） |

Vite プラグインが起動時に自動判定するため、設定変更は不要。

## pnpm scripts

| コマンド | 説明 |
|---------|------|
| `pnpm run dev` | Vite 開発サーバー起動（ローカル開発用） |
| `pnpm run build:gas` | クライアントビルド → GAS 用 HTML 生成 |
| `pnpm run deploy` | ビルド + clasp push（**通常はこれを使う**） |
| `pnpm run push` | clasp push のみ（ビルド済みの場合） |
| `pnpm run open` | GAS エディタを開く |
| `pnpm run typecheck` | TypeScript 型チェック |
| `pnpm run format` | Prettier でフォーマット |

### ビルドパイプライン

```
pnpm run deploy
  ├─ vite build          → dist/assets/index.js, dist/assets/gas-pomodoro.css
  ├─ tsx build-gas.ts
  │   ├─ esbuild         → src/ReactVendor.html  (React + jsx-runtime IIFE)
  │   └─ wrap + transform → src/ClientBundle.html (CSS + JS, テンプレートリテラル変換)
  └─ clasp push          → GAS にアップロード
```

`clasp push` はデプロイ済みの Web アプリには自動反映されない。開発中は GAS エディタの「デプロイをテスト」から最新コードで動作確認できる。本番 URL に反映するには新しいデプロイを作成する。

## エディタの特殊操作

メモ・作業記録エディタでは、Markdown 記法で特殊ブロックを挿入できる。

### テーブル

行頭にパイプ区切りで入力して Enter:

```
| 列1 | 列2 | 列3 |
```

- **Tab** — 次のセルに移動（最後のセルで押すと行を追加）
- **Shift+Tab** — 前のセルに移動

### Callout（注意書き）

行頭に `:::` + タイプ名を入力して Enter:

```
:::note
:::tip
:::important
:::warning
:::caution
```

### Details（折りたたみ）

行頭に入力して Enter:

```
:::details
or
:::summary
```

### タスクリスト

行頭に入力してスペース:

```
[ ] 未完了タスク
[x] 完了タスク
```

### その他のショートカット

| 操作 | ショートカット |
|------|----------------|
| リスト項目のインデント | Tab |
| リスト項目のアウトデント | Shift+Tab |
| コードブロック内の全選択 | Ctrl/Cmd+A |
| リンクを開く | Ctrl/Cmd+クリック |

### 画像

ツールバーボタン、ドラッグ&ドロップ、クリップボードからのペーストで挿入可能。画像は Google Drive に保存される。

## 技術的な制約

- **タイマーはクライアントサイドで動作** — GAS の 6 分実行制限のため、サーバーサイドでタイマーは動かせない
- **localStorage で状態永続化** — ページリロード時にタイマーを復元する
- **通知音は Web Audio API で生成** — GAS HtmlService は静的ファイルを配信できないため
- **`document.title` は変更不可** — GAS の iframe サンドボックスの制約
