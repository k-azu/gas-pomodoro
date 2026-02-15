# 画像アップロード機能

## 概要

エディタに画像を挿入すると、Google Drive に保存し、GAS サーバー経由で画像を取得・表示する。
画像は Drive 上で非公開のまま運用する（共有設定なし）。

### 関連ファイル

| ファイル | 役割 |
|----------|------|
| `src/ImageService.ts` | GAS サーバー側: Drive への保存・取得 |
| `src/MemoEditor.html` | クライアント側: アップロード、キャッシュ、表示、URL 変換 |

### URL の二重構造

エディタ内部と永続化で異なる URL 形式を使い分ける。

| 用途 | URL 形式 | 例 |
|------|----------|-----|
| エディタ表示 | blob URL | `blob:https://script.googleusercontent.com/abc-123` |
| localStorage / Spreadsheet | Drive file URL | `https://drive.google.com/file/d/ABC123/view` |

blob URL はページのライフサイクルに紐づくため永続化できない。
Drive file URL は CORP でブラウザから直接読み込めない。
この制約から、表示用と保存用で URL を変換する必要がある。

---

## 1. 画像アップロードの流れ

ユーザーがペースト / ドラッグ&ドロップ / ツールバーボタンで画像を挿入したとき。

```
ユーザーが画像を挿入
│
▼ handleImageUpload(file)
File から Blob + blob URL を作成（表示用、即座）
│
▼ FileReader.readAsDataURL(file)
base64 文字列を取得（サーバー送信用）
│
▼ serverCall("uploadImage", base64, fileName, mimeType)
│   ┌─────────────────────────────────────────┐
│   │ GAS サーバー (ImageService.ts)          │
│   │  1. MIME タイプ検証                      │
│   │  2. base64 デコード → サイズ検証 (5MB)  │
│   │  3. PomodoroImages フォルダに保存        │
│   │  4. { fileId } を返す                   │
│   └─────────────────────────────────────────┘
│
▼ registerBlobUrl(fileId, blobUrl)
メモリ上のマッピングに登録:
  fileIdToBlobUrl[fileId] = blobUrl
  blobToDriveUrl[blobUrl] = driveFileUrl(fileId)
│
▼ setCachedImage(fileId, blob)
IndexedDB (gas_pomodoro_images) に Blob を直接保存
│
▼ resolve(blobUrl)
エディタに blob URL を返す → <img src="blob:..."> として表示
```

**ポイント:**
- エディタには blob URL が渡されるため、CORP エラーが発生しない
- IndexedDB にも Blob を保存するため、次回リロード時にサーバーコール不要
- base64 はサーバー送信にのみ使用（`google.script.run` がバイナリを渡せないため）

---

## 2. 画像取得の流れ（ページリロード時）

localStorage に保存された Drive URL をエディタに渡す前に、blob URL に事前解決する。

```
init()
│
▼ localStorage から markdown を読み出し
"![image](https://drive.google.com/file/d/ABC123/view)"
│
▼ resolveDriveUrls(md)
正規表現で Drive file URL を検出 → fileId を抽出
│
▼ resolveFileId(fileId)  ※ 3段階のフォールバック
│
├─ 1. メモリキャッシュ (fileIdToBlobUrl)
│     ヒット → 即座に blob URL を返す
│
├─ 2. IndexedDB (getCachedImage)
│     ヒット → Blob → URL.createObjectURL → blob URL
│     マッピングを登録して返す
│
└─ 3. GAS サーバー (serverCall("getImageBase64"))
      ┌────────────────────────────────────┐
      │ GAS サーバー (ImageService.ts)     │
      │  1. DriveApp.getFileById(fileId)   │
      │  2. MIME タイプ検証                 │
      │  3. base64 エンコードして返す       │
      └────────────────────────────────────┘
      base64 → Blob → IndexedDB にキャッシュ
      → URL.createObjectURL → blob URL
│
▼ markdown 内の Drive URL を blob URL に置換
"![image](blob:https://script.googleusercontent.com/abc-123)"
│
▼ mountMemoEditor({ initialValue: 解決済み markdown })
エディタは blob URL で画像を表示（CORP エラーなし）
```

**ポイント:**
- エディタマウント前に全画像を解決するため、壊れた画像が表示されない
- IndexedDB キャッシュにより、2回目以降のリロードはサーバーコール不要
- `setValue()` / `setViewerValue()` など外部からの値セットも同じ `resolveDriveUrls()` を通す

---

## 3. Markdown 保存の流れ

エディタ内の blob URL を Drive URL に変換して永続化する。

### 3a. 自動保存（onChange → localStorage）

```
エディタの内容が変更される
│
▼ onChange(md) が発火
markdown には blob URL が含まれる:
"![image](blob:https://script.googleusercontent.com/abc-123)"
│
▼ blobUrlsToDrive(md)
blobToDriveUrl マッピングを使い、全ての blob URL を Drive URL に置換:
"![image](https://drive.google.com/file/d/ABC123/view)"
│
▼ lsSet(key, 変換後の markdown)
localStorage に Drive URL 形式で保存
```

### 3b. サーバー送信（getValue → Spreadsheet）

```
ポモドーロ完了 → getValue() / getRecordValue() が呼ばれる
│
▼ editor.getValue()
markdown には blob URL が含まれる
│
▼ blobUrlsToDrive(normalizeEmpty(md))
blob URL → Drive URL に変換
│
▼ 呼び出し元がサーバーに送信 → Spreadsheet に保存
```

**ポイント:**
- `blobUrlsToDrive()` は `blobToDriveUrl` マッピング（メモリ上）を全て走査して文字列置換
- マッピングは `registerBlobUrl()` でアップロード時・画像取得時に登録される

---

## 4. ダブルクリックで元画像を開く

```
ユーザーが <img> をダブルクリック
│
▼ dblclick ハンドラ
blobToDriveUrl[img.src] から Drive file URL を取得
│
▼ window.open(driveFileUrl, "_blank")
Drive のファイルページが新しいタブで開く
```

---

## データの保存場所

| データ | 保存先 | 形式 | 寿命 |
|--------|--------|------|------|
| 画像ファイル本体 | Google Drive (PomodoroImages/) | バイナリ | 永続 |
| 画像キャッシュ | IndexedDB (gas_pomodoro_images) | Blob | ブラウザに依存 |
| 画像 URL を含む markdown | localStorage / Spreadsheet | Drive file URL 文字列 | 永続 |
| 表示用 blob URL | ブラウザメモリ | blob URL | ページのライフサイクル |
| URL マッピング | JS 変数 (blobToDriveUrl, fileIdToBlobUrl) | オブジェクト | ページのライフサイクル |
