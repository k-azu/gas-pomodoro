# VS Code Pomodoro への移行

GAS版のプロジェクト・案件・タスク・Pomodoro履歴を、[VS Code Pomodoro](https://github.com/k-azu/vscode-pomodoro) の記録用ワークスペース（Markdown＋front matter）へ移す手順。本文中のDrive画像もワークスペースへコピーする。

移行は2段階で行う。

1. GAS：`exportForVscode()`（[src/ExportService.ts](../src/ExportService.ts)）が、スプレッドシートの内容と参照画像をDriveへ書き出す。
2. ローカル：[scripts/export-to-vscode.ts](export-to-vscode.ts) が書き出したフォルダを読み、ワークスペースへMarkdownと画像を作る。

GAS側のデータは変更しない。

## 1. GASから書き出す

1. `pnpm run deploy` で `ExportService.ts` を含む版をGASへ反映する。
2. Apps Scriptエディタ（`pnpm exec clasp open`）で `exportForVscode` を選んで実行する。
3. 実行ログに件数と出力先URLが出る。「時間切れで…件の画像が残っています」と出た場合はもう一度実行する（コピー済みの画像は飛ばす）。
4. Driveの `PomodoroVSCodeExport` フォルダをダウンロードして展開する。複数のzipに分かれた場合は同じフォルダへ展開する。

書き出し内容：

| ファイル | 内容 |
| --- | --- |
| `data.json` | Projects・Cases・Tasks・PomodoroLog・Interruptions・Categories・InterruptionCategories の全行 |
| `images/<fileId>.<拡張子>` | 本文から `https://drive.google.com/file/d/<fileId>/view` で参照されている画像のコピー |

## 2. 試し実行する

移行先は、VS Code Pomodoroで使う記録用フォルダ。`--dry-run` は何も書き込まず、件数・警告・活動種別の対応を表示する。

```sh
E=<展開したPomodoroVSCodeExportフォルダ>
W=<移行先の記録用ワークスペース>
pnpm exec tsx scripts/export-to-vscode.ts --input "$E" --workspace "$W" --dry-run
```

### 活動種別を決める

GASのカテゴリは、移行先の `.pomodoro/activity-types.json` にある種別へ**名前が一致すれば自動で**対応付ける（全角・半角、大文字・小文字は区別しない）。記録で使われているのに一致しないカテゴリがあると、次のように一覧を出して止まる。

```
活動種別に対応付けられないカテゴリがあります:
  その他（2件）
既存の種別: activity-work（作業）, activity-learn（学習）, activity-meeting（会議）, activity-away（休憩／離席）
```

対応表のJSONを作り、`--type-map` で渡す。値は既存の種別ID、または `"new"`（そのカテゴリ名で種別を追加。色はGASの色から近いものを選ぶ）。

```json
{
  "その他": "new",
  "会議・ミーティング": "activity-meeting"
}
```

カテゴリが空の記録は、作業と作業中断が `activity-work`、休憩と作業外の中断が `activity-away` になる。記録で使われていないカテゴリは移さない。

## 3. 書き込む

警告を確認してから `--dry-run` を外して実行する。

```sh
pnpm exec tsx scripts/export-to-vscode.ts --input "$E" --workspace "$W" --type-map type-map.json
```

- 書き込み先に同名ファイルが一つでもあれば、何も書かずに中止する。やり直す場合は、前回作られたファイルを消してから実行する。
- 更新する既存ファイルは `.pomodoro/activity-types.json` だけで、`"new"` の種別を末尾に追加する。既存の種別や未知のキーは残す。
- 書き込み後、VS Codeでワークスペースを開き、コマンドパレットの **索引を再構築** を実行する。

その他のオプション：

| オプション | 既定値 | 内容 |
| --- | --- | --- |
| `--skip-activities` | なし | Pomodoro履歴を移さず、プロジェクト・案件・タスクだけを移す |
| `--projects-folder` | `projects` | 拡張の `pomodoro.projectsFolder` と合わせる |
| `--activities-folder` | `activities` | 拡張の `pomodoro.activitiesFolder` と合わせる |
| `--assets` | `assets` | 画像を置くフォルダ（各Markdownからの相対パス） |

## 変換規則

### プロジェクト・案件・タスク

| 移行先 | 内容 |
| --- | --- |
| `projects/p-<GASのID>/project.md` | プロジェクト |
| `projects/p-<プロジェクトID>/wi-<GASのID>.md` | 案件・タスク（所属プロジェクトのフォルダに置く） |

- IDはGASのUUIDに `p-` / `wi-` を付ける。案件と同じIDのタスクは `wi-<ID>-task` にする（GASのデータに実例がある）。
- 並び順はGASの順を保ち、`sortOrder` を1024刻みで振り直す。
- `isActive` がfalseのものは `archived: true`。
- タスクの `startedAt` → `startDate`、`dueDate` → `dueDate`（どちらも `YYYY-MM-DD`）。`completedAt` は状態が `done` のときだけ移す。
- GASの案件には状態がないため `todo` にする。
- `createdAt` は拡張では使わないが記録として残す。プロジェクト・案件の色は移さない（拡張に項目がない）。
- 所属プロジェクトがない案件・タスクは移さない。所属案件がないタスクはプロジェクト直下へ移す。いずれも警告を出す。

### Pomodoro履歴

| 移行先 | 内容 |
| --- | --- |
| `activities/YYYY/MM/ar-<GASのID>.md` | PomodoroLogの記録（年月はスプレッドシートのタイムゾーン） |
| 同上 | Interruptionsの中断（`parentActivityId` で元の作業記録を指す） |

- 開始・終了時刻はUTCのISO形式。終了時刻のない記録は未終了のまま移す。
- `type`（work / shortBreak / longBreak）→ `session.phase`。作業の `pomodoroSetIndex` → `session.workNumber`。休憩はGASでは次の作業の番号を持つため、直前の作業の番号にそろえる。
- 関連先はタスク・案件・プロジェクトの順に、移行できたものを `relatedTo` にする。
- GASの記録には名前がないため、本文の最初の行（見出し記号などを除き60字まで）を名前にする。休憩は名前なし。本文は全文残す。
- `completionStatus` は移さない。
- 作業記録の範囲外にある中断や重なる中断は、直さずに移して警告を出す。拡張側でも時刻エラーとして表示される。

### 画像

本文中のDrive URLを `assets/<fileId>.<拡張子>` に書き換え、参照している文書と同じフォルダの `assets/` にコピーする。Markdownの画像記法とHTMLの `<img>` のどちらも対象。書き出し時にDriveで見つからなかった画像はURLのまま残し、警告を出す。

## 移行後に確認すること

- サイドバーのツリーとタスク一覧で、プロジェクト・案件・タスクの階層と並び順。
- 画像を含む文書を開き、画像が表示されること。
- 活動履歴で、期間・活動種別ごとの合計時間。
- 警告に出た文書（所属の変更、ID変更、Driveに残った画像、時刻エラー）。
