# タスクタブ ドキュメント保存・サーバー同期 要件定義書

## 1. 目的

タスクタブのドキュメント（プロジェクト・案件・タスクの Wiki コンテンツ）を IndexedDB に保存・読み込みし、GAS/スプレッドシートとサーバー同期する仕組みを定義する。

## 2. 全体データ構造

### 2.1 エンティティの関係

```
Project 1──* Case 1──* Task
   │                     │
   │                     │
   └── content           └── content
       (Wiki)                (Wiki)
```

- Project は複数の Case を持つ
- Case は複数の Task を持つ
- Task は Case に属さず Project 直下にも配置できる
- Project / Case / Task はそれぞれ Wiki ドキュメント（content フィールド）を持つ

### 2.2 IndexedDB データベース

| 項目 | 値 |
|---|---|
| DB名 | `gas_pomodoro`（既存） |
| バージョン | 既存バージョンのまま（変更不要） |

### 2.3 オブジェクトストア一覧

| ストア | keyPath | 用途 |
|---|---|---|
| `projects` | `id` | プロジェクトのメタデータ + content |
| `cases` | `id` | 案件のメタデータ + content |
| `tasks` | `id` | タスクのメタデータ + content |

**廃止予定ストア:**

| ストア | 現状 | 目標 |
|---|---|---|
| `contents` | **現在使用中**（`saveContent` / `getContent` が読み書き） | content を各エンティティに統合後、使用停止 |
| `syncMeta` | 未使用 | コード上で使用しない（DB からは削除しない） |

ストアの削除には `onupgradeneeded` でのバージョンアップが必要だが、使用しないだけであれば不要。DB バージョンを上げないことで、旧バージョンのコードとの互換性を維持する。

### 2.4 現在の実装状況

**コンテンツ保存の現状:**

要件書では `contents` ストアを廃止し各エンティティの `content` フィールドに統合する設計だったが、**現在の実装では `contents` ストアに直接書き込んでいる**:

```javascript
// 現在の saveContent（TaskStore.html）
function saveContent(id, content, storeName) {
  return withLock(id, function () {
    return get("contents", id).then(function (existing) {
      var item = existing || { id: id };
      item.content = content;
      item.updatedAt = now;
      item._storeName = storeName;
      return put("contents", item);
    });
  });
}
```

- `saveContent` は `contents` ストアに書き込む（エンティティストアには書き込まない）
- `getContent` は `contents` ストアから読み込む
- `_storeName` フィールドでエンティティ種別を記録している

**初期化の現状:**

```javascript
// 現在の init（TaskStore.html）
function init() {
  return openDB();
}
```

- `init()` は `openDB()` のみ。サーバーデータの読み込みは行わない

**サーバー側の現状:**

TaskService.ts に以下の関数が全て実装済みだが、**クライアントから一切呼び出されていない**:

| サーバー関数 | 戻り値 | 状態 |
|---|---|---|
| `getAllTaskData()` | `{ projects, cases, tasks }` | 実装済・未接続 |
| `getProjectContent(id)` | `{ id, content, updatedAt }` | 実装済・未接続 |
| `getCaseContent(id)` | `{ id, content, updatedAt }` | 実装済・未接続 |
| `getTaskContent(id)` | `{ id, content, updatedAt }` | 実装済・未接続 |
| `addProject(id, name, color)` | `{ success, id }` | 実装済・未接続 |
| `addCase(id, projectId, name)` | `{ success, id }` | 実装済・未接続 |
| `addTask(id, projectId, caseId, name)` | `{ success, id }` | 実装済・未接続 |
| `updateProject(id, fields)` | `{ success }` | 実装済・未接続 |
| `updateCase(id, fields)` | `{ success }` | 実装済・未接続 |
| `updateTask(id, fields)` | `{ success }` | 実装済・未接続 |
| `archiveProject(id)` | `{ success }` | 実装済・未接続 |
| `archiveCase(id)` | `{ success }` | 実装済・未接続 |
| `archiveTask(id)` | `{ success }` | 実装済・未接続 |
| `reorderProjects(orderedIds)` | `{ success }` | 実装済・未接続 |
| `reorderCases(projectId, orderedIds)` | `{ success }` | 実装済・未接続 |
| `reorderTasks(parentId, orderedIds)` | `{ success }` | 実装済・未接続 |

### 2.5 Migration（contents → エンティティ統合）

`content` フィールドの追加は IndexedDB のスキーマレスな性質により、バージョンアップ不要（`put` 時にフィールドが追加される）。

既存の `contents` ストアにデータがある場合の migration:

```
openDB 後の初回起動時:
  1. localStorage の migration 完了フラグを確認（完了済みならスキップ）
  2. contents ストアが存在するか確認
  3. 存在する場合、getAll(contents) で全件取得
  4. 各 content レコードの _storeName に応じたストア（projects/cases/tasks）から
     get(storeName, record.id) で対象エンティティを取得
  5. エンティティが存在し、content フィールドが未設定の場合のみ
     entity.content = record.content → put(storeName, entity)
  6. migration 完了後、contents ストアの全レコードを削除（ストア自体は残す）
  7. localStorage に migration 完了フラグを記録し、2回目以降はスキップ
```

- migration は一度だけ実行する（冪等性のため、content 未設定の場合のみ書き込む）
- `contents` ストアのレコードは migration 後に削除する（二重管理を防ぐ）
- ストア自体は DB に残るが、コードからは参照しない
- migration 後、`saveContent` / `getContent` はエンティティストアを直接操作するよう変更する

### 2.6 レコード構造

**projects**
```javascript
{
  id, name, color, sortOrder, isActive,
  content,                               // Markdown テキスト（デフォルト ""）
  createdAt, updatedAt,
  // --- 同期用ローカル専用フィールド（サーバーには送信しない） ---
  _dirty,                                // boolean: メタデータに未同期の変更があるか
  _pendingCreate,                        // boolean: サーバーにまだ作成されていないか
  _contentLocalTs,                       // string (ISO): 最後のローカルコンテンツ保存時刻
  _contentSyncedTs,                      // string (ISO): 最後のサーバーコンテンツ同期成功時刻
  _lastServerUpdatedAt                   // string (ISO): サーバー側の updatedAt（マージ判定用）
}
```
Index: なし

**cases**
```javascript
{
  id, projectId, name, sortOrder, isActive,
  content,
  createdAt, updatedAt,
  // --- 同期用ローカル専用フィールド ---
  _dirty, _pendingCreate,
  _contentLocalTs, _contentSyncedTs,
  _lastServerUpdatedAt
}
```
Index: `projectId`

**tasks**
```javascript
{
  id, projectId, caseId, name, status, sortOrder, isActive,
  content,
  createdAt, completedAt, startedAt, dueDate, updatedAt,
  // --- 同期用ローカル専用フィールド ---
  _dirty, _pendingCreate,
  _contentLocalTs, _contentSyncedTs,
  _lastServerUpdatedAt
}
```
Index: `projectId`, `caseId`, `status`

### 2.7 設計根拠

`content` を各エンティティに埋め込む理由:

1. **データの整合性**: エンティティとコンテンツが同一レコードにあるため、孤児レコード（エンティティ削除後にコンテンツだけ残る）が発生しない
2. **entityType 不要**: ストア名がエンティティ種別を表すため、別途 `entityType` フィールドを管理する必要がない
3. **単一トランザクション**: メタデータとコンテンツの更新を1つの put で完結できる
4. **LRU eviction 不要**: コンテンツはキャッシュではなくソースオブトゥルースであり、勝手に削除してはならない
5. **実用上の規模**: プロジェクト・案件・タスクの合計件数は数百件程度であり、`getAll` でメタデータとコンテンツを一括取得してもパフォーマンス問題は起きない

## 3. トランザクション設計

### 3.1 基本方針

- 1操作 = 1トランザクション
- `put` は `tx.oncomplete` で resolve（書き込みの永続化を保証）
- `get` は `req.onsuccess` で resolve
- 戻り値は全て Promise
- エラーハンドリング方針:
  - `withLock` 内の `fn` が throw / reject した場合、`console.error` でログ出力する
  - `withLock` チェーンは継続する（`prev.then(fn, fn)` により、前の操作の成功/失敗に関わらず次の操作を実行）
  - `withLock` の戻り値は reject されるため、呼び出し側で必要に応じて `.catch()` できるが、必須ではない
  - `QuotaExceededError`（put 失敗）: ログ出力のみ。次回の保存操作で再試行される
  - `openDB` 失敗: エディタは空のまま editable にする（6.3 参照）

### 3.2 操作一覧

| 操作 | モード | ストア | 用途 |
|---|---|---|---|
| `get(storeName, id)` | readonly | 各ストア | エンティティ読み込み（content 含む） |
| `put(storeName, record)` | readwrite | 各ストア | エンティティ保存（content 含む） |
| `getAll(storeName)` | readonly | 各ストア | サイドバー表示用の全件取得 |
| `delete(storeName, id)` | readwrite | 各ストア | エンティティ削除 |
| `rawGet(storeName, id)` | readonly | 各ストア | ロックなしの直接読み込み（表示用） |

`rawGet` は `withLock` を経由せず IndexedDB を直接読み込む。pending な save があっても即座に resolve するため、コンテンツの即時表示に使用する（5.2 `attachWikiEditor` 参照）。返されるデータは save 完了前の旧データである可能性がある。

### 3.3 ID 単位のロック（withLock）

同一 ID への読み書きを直列化するため、ID ごとの Promise チェーンを使用する。
**コンテンツ保存・メタデータ更新・並べ替えなど、同一レコードを変更するすべての操作**が `withLock` を経由する。

```javascript
var _pendingOps = {};  // id → Promise

function withLock(id, fn) {
  var prev = _pendingOps[id] || Promise.resolve();
  var next = prev.then(fn, fn);  // 前の操作が成功/失敗どちらでも次を実行
  _pendingOps[id] = next;
  // チェーンの最後が自分自身なら cleanup（メモリリーク防止）
  next.then(function() {
    if (_pendingOps[id] === next) delete _pendingOps[id];
  });
  return next;
}
```

- 同一 ID → 直列（前の操作完了を待ってから実行）
- 異なる ID → 並列（互いにブロックしない）

#### なぜ withLock が必要か

content とメタデータが同一レコードにあるため、`withLock` なしで並行実行すると片方の変更が消える。

```
[withLock なしの場合]
t1  saveContent(A):    get(A) → {content:"old", name:"old"}
t2  updateEntity(A):   get(A) → {content:"old", name:"old"}
t3  saveContent(A):    put(A,  {content:"NEW", name:"old"})   ← content 更新
t4  updateEntity(A):   put(A,  {content:"old", name:"NEW"})   ← content が巻き戻る!
```

`withLock` で直列化すれば、t2 の get は t3 の put 後に実行されるため、両方の変更が保持される。

### 3.4 saveContent（コンテンツ保存）

`saveContent` では既存レコードを get → content フィールドのみ更新 → put を実行する。

**目標の実装（migration 後）:**

```
saveContent(id, content, storeName):
  return withLock(id, () => {
    1. get(storeName, id)                  // readonly tx
    2. existing が null なら return        // エンティティが存在しない = 保存しない
       record.content = content
       record.updatedAt = now()
       record._contentLocalTs = now()      // ← 同期用タイムスタンプ
    3. put(storeName, record)              // readwrite tx → oncomplete で resolve
  })
```

### 3.5 updateEntity（メタデータ更新）

メタデータの更新（名前変更・ステータス変更・日付変更など）も `withLock` を経由する。
同一 ID への複数の更新が競合した場合、最後の更新が反映される（last-write-wins）。

```
updateEntity(id, storeName, changes):
  return withLock(id, () => {
    1. get(storeName, id)                  // readonly tx
    2. existing が null なら return
       Object.assign(record, changes)      // 指定フィールドのみ上書き
       record.updatedAt = now()
    3. put(storeName, record)              // readwrite tx → oncomplete で resolve
  })
```

`withLock` により `saveContent` と `updateEntity` が同一 ID で並行しても、一方が他方の変更を上書きすることはない。

**同一 ID への content 保存 + メタデータ更新の例:**

```
t1  saveContent(A, "new text")  → withLock("A", ...)
      get(A) → {content:"old", name:"old"}
      put(A,  {content:"new text", name:"old"})      ← content 更新
t2  updateEntity(A, {name:"NEW"}) → withLock("A", ...)
      // t1 の完了を待ってから実行
      get(A) → {content:"new text", name:"old"}      ← t1 の結果を読む
      put(A,  {content:"new text", name:"NEW"})       ← 両方の変更が保持される
```

### 3.6 updateSortOrders（並べ替え）

ドラッグ&ドロップなどによる並べ替えでは、複数レコードの `sortOrder` を一括更新する。
各レコードの更新は個別の `withLock` で実行する。

```
updateSortOrders(storeName, sortOrderMap):
  // sortOrderMap = { id1: 0, id2: 1, id3: 2, ... }
  return Promise.all(
    Object.entries(sortOrderMap).map(([id, newOrder]) =>
      withLock(id, () => {
        1. get(storeName, id)
        2. existing が null なら return
           record.sortOrder = newOrder
           record.updatedAt = now()
        3. put(storeName, record)
      })
    )
  )
```

- 異なる ID の更新は**並列**に実行される（互いにブロックしない）
- 同一 ID への content 保存と並べ替えが競合しても、`withLock` により直列化される
- `sortOrder` は UI 上の並び順から算出した値をそのまま書き込むため、レコードの現在値に依存しない
- 部分失敗時の扱い: 一部 ID の put が失敗しても、他の ID の更新は独立して成功する。失敗した ID は `console.error` でログ出力する。`sortOrder` は次回のドラッグ&ドロップ操作で再度全件書き込まれるため、明示的なリトライは行わない

## 4. 保存タイミング

### 4.1 エディタ変更時

```
onChange 発火
  → _userHasEdited = true
  → clearTimeout(debounce)
  → debounce = setTimeout(2000ms) {
      saveContent(taskWikiDocId, md, taskWikiStoreName)
    }
```

### 4.2 ドキュメント切替時

```
flushWikiSave(oldId):
  if (!_userHasEdited) return
  md = editor.getValue()
  saveContent(oldId, md, storeName)
```

### 4.3 ページ離脱時

```
beforeunload / visibilitychange("hidden"):
  clearTimeout(debounce)
  flushWikiSave(taskWikiDocId)   // Promise の resolve は待たない
```

`flushWikiSave` は `withLock` 経由のため Promise を返すが、`beforeunload` ハンドラは async を待てない。IndexedDB トランザクションはハンドラ内で**開始**されれば、ブラウザの close 手順で完了する（6.1 参照）。

### 4.4 まとめ

| タイミング | 条件 | デバウンス |
|---|---|---|
| onChange 後 | 常に | 2秒後に実行 |
| ドキュメント切替 | `_userHasEdited === true` | 即座 |
| beforeunload | `_userHasEdited === true` | 即座 |
| visibilitychange hidden | `_userHasEdited === true` | 即座 |

### 4.5 並行書き込みの排除

同一 ID への**すべての書き込み操作**（`saveContent` / `updateEntity` / `updateSortOrders`）は `withLock` により直列化される。
`getContent` は読み込み専用のため `withLock` を経由せず、`rawGet` で即座に読み込む。

1. 同一 ID への書き込み操作は `withLock(id, ...)` で直列化されるため、read-modify-write の競合は発生しない
2. 異なる ID 同士は並列に実行される（ブロックしない）
3. デバウンス + `clearTimeout` は `withLock` の上の追加的な最適化（不要な書き込みの削減）
4. `getContent` は `rawGet` を使うため、pending な save の完了を待たずに即座に resolve する。編集の有効化は `attachWikiEditor` 内の `withLock(id, noop)` + サーバー比較完了後に行う

**連続ページ切替（A → B → A）の例:**

```
t1  A → B 切替
      flushWikiSave(A) → withLock("A", save)   // "A" のチェーンに追加
      B はキャッシュなし → rawGet("B")          // ロックなし → 即表示（read-only）
      withLock("B", noop) → resolveWithServer("B") → setEditable(true)

t2  B → A 切替
      flushWikiSave(B)                          // B が未編集なら何もしない
      A はキャッシュあり → switchDocument("A")   // IDB/サーバーアクセスなし、即座に復元・編集可能
```

**コンテンツ保存中にメタデータ更新 + 並べ替えが発生した例:**

```
t1  saveContent(A)           → withLock("A", ...)  // content 更新
t2  updateEntity(A, {name})  → withLock("A", ...)  // t1 完了後に実行（直列）
t3  updateSortOrders({A:2, B:1, C:0})
      → withLock("A", ...)   // t2 完了後に実行（直列）
      → withLock("B", ...)   // "B" は空 → 即実行（A と並列）
      → withLock("C", ...)   // "C" は空 → 即実行（A と並列）
```

## 5. 読み込みフロー

### 5.1 getContent

```
getContent(id, storeName):
  return rawGet(storeName, id).then(record =>
    record ? (record.content ?? "") : null
  )
```

戻り値: `Promise<string | null>`

`withLock` は不要。理由:
- コンテンツ読み込みの唯一の用途は `attachWikiEditor` での初期表示（read-only）であり、即時性が優先される
- pending な save 完了前の旧データを読んでも、エディタの `switchDocument` キャッシュにより正しい内容に復元される（6.6 参照）
- 編集の有効化は `attachWikiEditor` 内の `withLock(id, noop)` + サーバー比較完了後に行う（5.3 参照）

### 5.2 読み込み戦略

データの読み込みは 3 層で行う。

```
速い ← ──────────────────────────────────── → 永続的
エディタキャッシュ（メモリ） → IndexedDB → サーバー（スプレッドシート）
```

| 層 | 内容 | 特性 |
|---|---|---|
| エディタキャッシュ | `switchDocument` がドキュメントごとに保持する state（テキスト・undo 履歴・カーソル位置） | 未保存の編集を含む最新データ。セッション中のみ有効 |
| IndexedDB | `saveContent` / `put` で永続化されたデータ | 永続データ。pending save 完了前は旧データの可能性あり |
| サーバー | 最後に同期されたコンテンツ | 他デバイスの変更を含む。`getXxxContent(id)` で取得 |

エディタキャッシュは常に IndexedDB 以上に新しいデータを持つ（編集 → デバウンス → IndexedDB 保存の順のため）。
キャッシュがある場合は IndexedDB もサーバーも読む必要がなく、即座に編集可能。

### 5.3 attachWikiEditor

```
attachWikiEditor(target, id, storeName):

  [同じ id]
    target.appendChild(_wikiContainer)   // DOM に再配置するだけ
    restoreWikiScroll(id)
    return                               // undo/cursor/selection/content 全て保持

  [異なる id]
    1. saveWikiScroll()                  // 旧ドキュメントのスクロール位置を保存
    2. clearTimeout(debounce)
    3. flushWikiSave(oldId)              // 旧ドキュメントの withLock チェーンに追加
    4. taskWikiDocId = id
    5. taskWikiStoreName = storeName
    6. _userHasEdited = false
    7. target.appendChild(_wikiContainer)

    // ── キャッシュの有無で分岐 ──
    8. if editor.hasDocument(id):
         // キャッシュヒット: 即座に復元、IDB/サーバーアクセス不要
         switchDocument(id)              // キャッシュから復元
         restoreWikiScroll(id)
         setEditable(true)              // キャッシュが最新 → 即座に編集可能

       else:
         // キャッシュミス: IDB → サーバー比較 → editable
         setEditable(false)

         // ── Phase 1: IDB から即座に表示（read-only） ──
         rawGet(storeName, id).then(record =>
           if (taskWikiDocId !== id) return   // stale チェック
           switchDocument(id, record?.content ?? "")
           restoreWikiScroll(id)
         )

         // ── Phase 2: サーバーと比較して確定 → editable ──
         withLock(id, () => {}).then(() =>
           if (taskWikiDocId !== id) return
           return resolveWithServer(id, storeName)
         ).then(() =>
           if (taskWikiDocId !== id) return
           setEditable(true)
         )
```

#### resolveWithServer（サーバーとの比較・解決）

```
resolveWithServer(id, storeName):
  // タイムアウト付きでサーバーからコンテンツを取得
  return withTimeout(getXxxContent(id), 5000)
    .then(serverResult =>
      if (!serverResult) return          // サーバーにデータなし
      resolveContentConflict(id, storeName, serverResult)
    )
    .catch(err =>
      // タイムアウトまたはネットワークエラー
      // → IDB のデータのまま editable にする（次回ページロードで再試行）
      console.warn("[TaskStore] server content check failed:", err)
    )
```

- `withTimeout` は Promise に 5 秒のタイムアウトを設定するヘルパー
- タイムアウト/エラー時は IDB のコンテンツで editable にする（オフラインファースト）
- `resolveContentConflict` はコンフリクト解決ロジック（8.5 参照）

**キャッシュヒット時（A → B → A）:**
- エディタキャッシュが最新データを持っているため、IDB/サーバー読み込み不要
- pending save は旧データを IndexedDB に書き込む操作であり、エディタの表示には影響しない
- ロック待機なしで即座に編集可能
- サーバーとの整合性はこのドキュメントの初回表示時（キャッシュミス時）に既にチェック済み

**キャッシュミス時（セッション中の初回読み込み）:**
- Phase 1: `rawGet` で IDB から即座に読み込み、read-only で内容を表示
- Phase 2: `withLock` で pending save 完了を待ち、サーバーからコンテンツを取得してコンフリクト解決
- コンフリクト解決完了後に `setEditable(true)`
- ユーザーが編集を開始する前にサーバーとの整合性が確保されるため、「編集中にサーバー応答が割り込む」ケースが発生しない
- サーバーがタイムアウト（5秒）またはエラーの場合は、IDB のデータで editable にする（オフラインファースト）

## 6. エッジケース

### 6.1 beforeunload 時の書き込み完了

- `put` のトランザクションは `beforeunload` 内で開始されれば、ブラウザの close connection 手順で完了する
- 完了しなかった場合、直前の saveContent 成功時点の内容が残る（最大2秒分の損失）

### 6.2 stale な Promise の結果

- `getContent` / `rawGet` / `withLock` の resolve 前にドキュメントが切り替わった場合、`taskWikiDocId !== id` チェックで結果を破棄する

### 6.3 openDB 失敗

- IndexedDB が利用不可の場合、`saveContent` / `getContent` は reject する
- エディタは空のまま editable にする（データは保存されない）

### 6.4 put 失敗（QuotaExceededError）

- ログ出力のみ（次回の saveContent で再試行される）

### 6.5 エンティティ未作成での saveContent

- `saveContent` は get で既存レコードを取得し、content フィールドのみ更新する
- レコードが存在しない場合は何もしない（エンティティ作成は別の操作で行う）

### 6.6 A → B → A の高速切替

`attachWikiEditor` はキャッシュの有無で分岐するため（5.3 参照）、このケースは常にキャッシュヒットとなる。

```
t1  A を表示（キャッシュミス → rawGet で IndexedDB から読み込み）
t2  B に切替（flushWikiSave(A) 開始、A のキャッシュはエディタに残る）
t3  A に戻る（キャッシュヒット → IndexedDB アクセスなし、即座に復元・編集可能）
```

- A のエディタキャッシュには未保存の編集を含む最新データがある
- pending save（t2 の flushWikiSave）は IndexedDB への永続化であり、エディタ表示には影響しない
- IndexedDB から旧データを読んでしまう問題自体が発生しない

## 7. 廃止する要素

| 要素 | 理由 |
|---|---|
| `contents` ストア（migration 後） | content を各エンティティに統合 |
| `syncMeta` ストア | 未使用 |
| `_dirtyContents` | メモリキャッシュ不要 |
| `entityType` フィールド | ストア名で判別可能 |

---

## 8. サーバー同期

以下のセクションでは、IndexedDB とスプレッドシート間のサーバー同期機能を定義する。
メモタブ（MemoSidebar.html）の同期戦略を参考にした設計。

### 8.1 同期アーキテクチャ

```
クライアント（ブラウザ）                    サーバー（GAS）
┌──────────────────────┐               ┌──────────────────┐
│  エディタキャッシュ     │               │  スプレッドシート    │
│       ↕              │               │  (永続バックアップ)  │
│  IndexedDB           │ ←── 同期 ──→  │                  │
│  (ローカルSoT)        │               │                  │
└──────────────────────┘               └──────────────────┘
```

- **IndexedDB**: ローカルのソースオブトゥルース（オフラインファースト）
- **スプレッドシート**: 永続バックアップ・クロスデバイス同期
- ネットワーク障害時もローカル操作は継続可能

### 8.2 ダーティトラッキング

各エンティティに以下のローカル専用フィールド（`_` プレフィクス）を追加し、同期状態を追跡する。サーバーには送信しない。

| フィールド | 型 | 用途 |
|---|---|---|
| `_dirty` | boolean | メタデータに未同期の変更があるか |
| `_pendingCreate` | boolean | サーバーにまだ作成されていないか |
| `_contentLocalTs` | string (ISO) | 最後のローカルコンテンツ保存時刻 |
| `_contentSyncedTs` | string (ISO) | 最後のサーバーコンテンツ同期成功時刻 |
| `_lastServerUpdatedAt` | string (ISO) | サーバー側の `updatedAt`（マージ判定用） |

**ダーティフラグの設定タイミング:**

| 操作 | 設定するフラグ |
|---|---|
| `addProject` / `addCase` / `addTask` | `_pendingCreate = true`, `_dirty = true` |
| `updateProject` / `updateCase` / `updateTask` | `_dirty = true` |
| `archiveProject` / `archiveCase` / `archiveTask` | `_dirty = true` |
| `reorderProjects` / `reorderCases` / `reorderTasks` | 各エンティティに `_dirty = true` |
| `saveContent` | `_contentLocalTs = now()` |

### 8.3 読み込み戦略（サーバー → IndexedDB）

#### 初期ロード（ページ読み込み時）

```
init():
  1. openDB()
  2. IndexedDB から getAll → 即座に UI 表示（既存動作）
  3. バックグラウンドで getAllTaskData() を呼び出し
  4. サーバーレスポンスを mergeServerData() でマージ
  5. マージ結果に基づき UI を更新
```

**mergeServerData のマージルール:**

```
各エンティティについて:

1. サーバーのみに存在（ローカルにない）:
   → IndexedDB に追加（他デバイスで作成されたデータ）

2. ローカルのみに存在:
   a. _pendingCreate === true → サーバーへの create を予約
   b. _pendingCreate !== true → 他デバイスで削除された可能性
      → ローカルからも削除（またはアーカイブ済みとして扱う）

3. 両方に存在:
   a. ローカルに未同期の変更なし（_dirty !== true）:
      → サーバーのメタデータで IndexedDB を更新
   b. ローカルに未同期の変更あり（_dirty === true）:
      → ローカルを保持、サーバーへの push を予約
```

#### コンテンツロード（ノード選択時）

`attachWikiEditor` のキャッシュミス時に、サーバー比較を editable の前提条件として実行する（5.3 参照）。

```
キャッシュミス:
  1. rawGet → IDB のコンテンツを即座に表示（read-only）
  2. withLock 完了後、resolveWithServer(id) を実行:
     a. getXxxContent(id) でサーバーからコンテンツ取得（5秒タイムアウト）
     b. タイムスタンプ比較によるコンフリクト解決（8.5 参照）
     c. 解決結果に応じてエディタを更新 or サーバーへ push 予約
  3. 解決完了後に setEditable(true)

キャッシュヒット:
  → 即座に setEditable(true)（サーバーチェックなし）
```

ユーザーが編集を開始する前にサーバーとの整合性が確保されるため、「編集中にサーバー応答が割り込む」コンフリクトが発生しない。

### 8.4 書き込み戦略（IndexedDB → サーバー）

| 操作 | IndexedDB | サーバー同期タイミング |
|------|-----------|---------------------|
| 作成（add） | 即時 | 即時（fire-and-forget） |
| メタデータ変更（名前/ステータス/日付等） | 即時 | 1秒デバウンス |
| アーカイブ | 即時 | 即時 |
| 並べ替え | 即時 | 5秒デバウンス |
| コンテンツ編集 | 500msデバウンス→IDB | 30秒デバウンス→サーバー |
| コンテンツフラッシュ（タブ切替/ページ離脱） | 即時→IDB | 即時→サーバー |

**同期成功時のフラグ更新:**

```
サーバー同期成功後:
  _dirty = false
  _pendingCreate = false
  _lastServerUpdatedAt = serverResponse.updatedAt   // 8.8 参照
```

**コンテンツ同期成功後:**

```
  _contentSyncedTs = _contentLocalTs
  （= ローカル保存時刻と同期時刻が一致 → 未同期の変更なし）
```

### 8.5 コンフリクト解決（メモタブと同じパターン）

```
localTs  = entity._contentLocalTs   (最後のローカル保存時刻)
syncedTs = entity._contentSyncedTs  (最後のサーバー同期成功時刻)
serverTs = サーバーレスポンスの updatedAt

hasLocalEdits = localTs > syncedTs
serverIsNewer = serverTs !== syncedTs

1. syncedTs なし（初回同期）:
   - ローカルコンテンツあり → ローカルを保持、サーバーへ push
   - なし → サーバーのコンテンツを使用

2. ローカル変更あり＋サーバーも変更あり（コンフリクト）:
   - ユーザー確認ダイアログ（メモと同じ）
   - OK → サーバーで上書き
   - キャンセル → ローカルを保持、サーバーへ push

3. ローカル変更のみ → サーバーへ push
4. サーバー変更のみ or 両方変更なし → サーバーを使用
```

### 8.6 リトライ戦略

- 指数バックオフ: 1s → 2s → 4s → 8s → 16s（最大5回）
- 失敗後: `syncError` イベント発行、UI にエラー表示
- ページ再読み込み時: `requeueDirtyRecords()` で未同期分を再キュー

```
requeueDirtyRecords():
  1. getAll("projects"), getAll("cases"), getAll("tasks") を並列取得
  2. _dirty === true or _pendingCreate === true のレコードを抽出
  3. 各レコードに対して対応するサーバー同期をスケジュール
  4. _contentLocalTs > _contentSyncedTs のレコードについて
     コンテンツ同期もスケジュール
```

### 8.7 エッジケース（同期関連）

| ケース | 対処 |
|--------|------|
| ページクローズ時の未保存コンテンツ | `beforeunload` で IDB に即時保存。サーバー同期は次回ロード時に `requeueDirtyRecords()` |
| 作成直後のアーカイブ | create sync 完了後に archive sync を実行（`_pendingCreate` チェック） |
| A→B→A の高速切替 | エディタキャッシュヒット、IDB/サーバーアクセス不要 |
| ネットワーク障害 | IDB に安全に保存済み、リトライで復旧 |
| シートのセル上限（50,000文字） | サーバー呼び出し失敗 → リトライ → エラー表示。IDB のデータは安全 |
| ブラウザによる IDB 削除 | サーバーからメタデータ復元（`getAllTaskData`）、コンテンツはオンデマンド復元（`getXxxContent`） |

### 8.8 サーバー側変更

`updateProject` / `updateCase` / `updateTask` の戻り値に `updatedAt` を追加:

```
現在: { success: boolean }
変更: { success: boolean, updatedAt: string }
```

これにより、クライアントはサーバー側の最終更新時刻を取得し、次回のコンフリクト判定に使用できる。

### 8.9 init の変更

```
init():
  1. openDB()
  2. migration（2.5 参照）
  3. requeueDirtyRecords()              // 前回未完了の同期を再キュー
  4. バックグラウンドで getAllTaskData() → mergeServerData()
  5. return（UI 表示は IndexedDB のデータで即座に行う）
```

## 9. 公開 API

**コンテンツ操作:**

```javascript
TaskStore.saveContent(id, content, storeName) → Promise<void>
TaskStore.getContent(id, storeName) → Promise<string | null>
```

**エンティティ操作（TaskPanel から呼び出される既存 API）:**

```javascript
TaskStore.get(storeName, id) → Promise<Record | undefined>
TaskStore.getAll(storeName) → Promise<Record[]>
TaskStore.put(storeName, record) → Promise<void>
TaskStore.delete(storeName, id) → Promise<void>
TaskStore.updateEntity(id, storeName, changes) → Promise<void>
TaskStore.updateSortOrders(storeName, sortOrderMap) → Promise<void>
```

**同期操作（新規追加）:**

```javascript
TaskStore.mergeServerData(serverData)                      → Promise<void>
TaskStore.requeueDirtyRecords()                            → Promise<void>
TaskStore.flushAllSyncs()                                  → Promise<void>
TaskStore.scheduleContentSync(type, id)                    → void
TaskStore.syncContentToServer(type, id)                    → Promise<void>
TaskStore.resolveContentConflict(id, store, serverResult)  → Promise<{useServer: boolean, content: string}>
```

**イベント（新規追加）:**

```javascript
TaskStore.on("syncError", callback)    // { entityType, id, error }
```

`storeName` は `"projects"` / `"cases"` / `"tasks"` のいずれか。呼び出し側（TaskPanel）がエンティティの種別に応じて指定する。
