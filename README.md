# gas-pomodoro

Google Apps Script + Spreadsheet で動くポモドーロタイマー。

## セットアップ

### 前提条件

- Node.js
- Google アカウント
- [clasp](https://github.com/nicholaschiang/clasp) がインストール済み (`npm install -g @google/clasp`)

### 1. 依存パッケージのインストール

```bash
npm install
```

### 2. clasp にログイン

```bash
npx clasp login
```

ブラウザが開くので Google アカウントで認証する。

### 3. GAS プロジェクトの作成

**新規作成する場合:**

```bash
npx clasp create --type sheets --rootDir src/ --title "Pomodoro Timer"
```

これで `.clasp.json` が自動生成され、Spreadsheet と GAS プロジェクトが作られる。

**既存の GAS プロジェクトに接続する場合:**

`.clasp.json` を手動で作成:

```json
{
  "scriptId": "<GASプロジェクトのスクリプトID>",
  "rootDir": "src/"
}
```

スクリプトIDは GAS エディタの「プロジェクトの設定」から確認できる。

### 4. コードをプッシュ

```bash
npm run push
```

初回プッシュでシート（PomodoroLog, Categories, TimerConfig 等）が自動作成される。

### 5. Web アプリとしてデプロイ

1. `npx clasp open` で GAS エディタを開く
2. 「デプロイ」→「新しいデプロイ」
3. 種類：「ウェブアプリ」を選択
4. 次のユーザーとして実行：「自分」
5. アクセスできるユーザー：「自分のみ」
6. 「デプロイ」をクリック
7. 初回は権限の承認が必要 — 「詳細」→「(プロジェクト名)に移動」で許可

デプロイ後に表示される URL でタイマーにアクセスできる。

### 開発時のワークフロー

```bash
# コードを変更後にプッシュ
npm run push

# Web アプリを開く
npm run open
```

`clasp push` はデプロイ済みの Web アプリには自動反映されない。開発中は GAS エディタの「デプロイをテスト」から最新コードで動作確認できる。本番 URL に反映するには新しいデプロイを作成する。

## プロジェクト構成

```
src/
├── appsscript.json        # GAS マニフェスト
├── Code.ts                # doGet(), include(), getSpreadsheetUrl()
├── SpreadsheetService.ts  # 記録の読み書き・集計
├── CategoryService.ts     # カテゴリ CRUD
├── TimerConfigService.ts  # タイマー設定読込
├── InitService.ts         # Spreadsheet 初期化 (冪等)
├── index.html             # メイン HTML テンプレート
├── Stylesheet.html        # CSS
├── JavaScript.html        # タイマーエンジン・状態管理
├── RecordForm.html        # 記録フォーム UI
└── Notification.html      # 通知音 (Web Audio API)
```

## 技術的な制約

- **タイマーはクライアントサイドで動作** — GAS の 6 分実行制限のため、サーバーサイドでタイマーは動かせない
- **localStorage で状態永続化** — ページリロード時にタイマーを復元する
- **通知音は Web Audio API で生成** — GAS HtmlService は静的ファイルを配信できないため
- **`document.title` は変更不可** — GAS の iframe サンドボックスの制約
