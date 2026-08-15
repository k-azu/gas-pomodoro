# ADR 0002: メモとタスクでEditorStateを一つずつ保持する

- Status: Accepted
- Date: 2026-08-15
- Deciders: Repository owner
- Supersedes: [ADR 0001](0001-use-server-confirmed-memory-document-state.md)

## Context

ADR 0001は、未選択文書をサーバー確認済み文字列snapshotとして保持し、選択中の一文書だけをEditorStateへ変換すると定めた。しかし、アプリには独立したメモタブとタスクタブがあり、利用者は両種類を行き来する。実装も各タブのeditorをマウントしたまま表示だけを切り替えており、メモ用とタスク用の二つのEditorStateを保持している。

EditorStateをアプリ全体で一つにすると、メモ・タスク間の切り替えでもeditorの破棄と再生成が必要になる。一方、文書ごとにEditorStateを持つと、文書数に比例して可変なworking stateが増え、未送信本文の所在と保存境界が複雑になる。種類ごとの即時切り替えと、未送信状態を限定する方針を両立させる境界を明確にする必要がある。

ADR 0001のSpreadsheet正本、文書IndexedDB不使用、CAS、保存ACK後の遷移、再取得、複数タブ制御に関する判断は引き継ぐ。このADRはEditorStateの保持単位と、メモ・タスク間遷移時の責務を明確化する。

## Non-goals

- 文書ごとにEditorState、undo/redo、selectionを保持しない。
- メモとタスクのEditorStateを相互に共有しない。
- 非表示タブで未送信本文を蓄積しない。
- Pomodoro記録、割り込み記録、履歴詳細のeditor状態をこの境界へ統合しない。これらは文書同期対象ではなく、各画面で独立したEditorStateを保持してよい。

## Decision

一つのブラウザタブ内で、メモ用EditorStateを一つ、タスク用EditorStateを一つ保持する。両方の文書タブが初期化済みなら、保持する文書同期対象のEditorStateは最大二つとする。Pomodoro記録と履歴詳細を含む文書同期対象外のeditorはこの上限へ含めず、それぞれ独立したEditorStateのままとする。

各種類のEditorStateは、その種類で現在選択している一文書だけを表す。同じ種類の別文書へ切り替えるときは、dirty本文と未確認metadataのサーバーACKを待ち、同じeditor instanceを新しいサーバー確認済み文字列snapshotでresetする。切り替え前のEditorState、undo/redo、selectionは破棄し、非選択文書には文字列snapshotだけを保持する。

メモ・タスク間を切り替えるときも、表示中editorがdirty、送信中、保存失敗、競合、metadata未確認であればACKを待ってから切り替える。切り替え後、非表示になる種類のEditorStateは保持してよいが、サーバーACK済みのclean状態でなければならない。これにより、表示を戻したときはネットワーク再取得とEditorState再生成をせず再表示できる。

未送信本文に対する文書遷移guard、`beforeunload`、ページ非表示時のbest-effort保存、Web Locksによる編集権は、現在表示中の文書editorだけが担当する。非表示のメモまたはタスクeditorは、重複した本文保存、遷移guard、編集lockを開始しない。metadata送信待ちはEditorStateに属さないglobal queueとして保護し、文書editorが未選択でも遷移guard、`beforeunload`、エラー表示、再送を有効にする。

未選択文書の正本は引き続きサーバー確認済みメモリsnapshotであり、EditorStateを文書cacheとして増やさない。本文をIndexedDBへ保存しない方針も変更しない。

## Rejected alternatives

### アプリ全体でEditorStateを一つだけ保持する

可変working stateを最小化できるが、メモ・タスク間の通常の切り替えでもeditorを破棄・再生成する。種類ごとに一つまでなら未送信本文の保存境界を限定でき、二種類間の即時切り替えも維持できるため採用しない。

### 文書ごとにEditorStateを保持する

文書を戻したときにundo/redoやselectionまで復元できるが、文書数に比例して可変状態と未送信候補が増える。現在選択中の文書以外を文字列snapshotへ限定する方針と反するため採用しない。

### 非表示の種類をアンマウントする

EditorStateを一つへ減らせるが、メモ・タスク間の切り替えでeditorの一時状態と再生成コストが発生する。二つまでという固定上限を許容するため採用しない。

## Consequences

### Positive

- メモ・タスク間は取得待ちとEditorState再生成なしで切り替えられる。
- EditorState数は文書数ではなく文書種類数で上限二つに固定される。
- 同じ種類の文書切り替えでは、未選択文書を文字列snapshotだけに保てる。
- 非表示editorをcleanに限定することで、未送信本文の保存処理は表示中editorへ集約できる。

### Negative

- アプリ全体で一つにする場合よりメモリ使用量が増える。
- 非表示editorもマウントされるため、保存・lock・ブラウザイベントを表示中editorだけへ限定する条件分岐が必要になる。
- メモ・タスク間の切り替え後も、非表示側のEditorStateはメモリに残る。

## Implementation

- 種類ごとのeditor mount境界: `client/components/layout/RightPanel.tsx`
- EditorStateとactive時だけの保存・lock境界: `client/hooks/useDocumentEditor.ts`
- 文書遷移の直列化: `client/lib/documentNavigationGuard.ts`
- サーバー確認済み文字列snapshot: `client/lib/documentStore.ts`

## Verification

- メモとタスクを初期化しても、文書EditorStateは各種類一つを超えない。
- 同じ種類の文書切り替えで、切り替え前文書のEditorStateを保持しない。
- dirtyなメモ・タスク間切り替えは、表示中本文のACK前に確定しない。
- 非表示editorはページ非表示イベント、遷移guard、Web Locksを重複登録しない。
- 種類を戻したときに文書本文の再取得を行わない。
- `python3 .agents/skills/create-adr/scripts/check_adrs.py --adr-dir docs/adr`
- `pnpm run format:check`
- `pnpm run typecheck`
- `pnpm run test:e2e`
