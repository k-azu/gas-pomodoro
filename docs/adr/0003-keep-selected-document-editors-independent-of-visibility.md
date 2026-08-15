# ADR 0003: 選択中のメモ・タスクを表示状態と独立して保持する

- Status: Accepted
- Date: 2026-08-15
- Deciders: Repository owner
- Supersedes: [ADR 0002](0002-keep-one-editor-state-per-document-type.md)

## Context

ADR 0002はメモ用とタスク用のEditorStateを一つずつ保持する一方、非表示になるEditorStateをサーバーACK済みのclean状態へ限定した。このため、本文を変更した直後にメモ、タスク、記録、履歴詳細などの画面タブを切り替えるだけでもGASの応答を待っていた。また、文書遷移guard、ページ非表示時の保存、終了警告、Web Lockの有効性が画面の表示状態へ連動し、同じEditorStateの責務が表示切り替えのたびに変化していた。

一つのブラウザタブで保持する文書EditorStateはメモ用とタスク用の最大二つに固定されている。未送信本文を持てる場所もこの二つへ限定できるため、表示中の一つだけをdirtyに限定する必要はない。画面を非表示にする操作と、EditorStateを別文書へ差し替える操作を分離し、選択中文書の状態機械を表示状態から独立させる。

Spreadsheetを唯一の永続的な正本とすること、本文をIndexedDBへ保存しないこと、revision CAS、競合時にlocalとserverの両本文を保持すること、通常はpollingしないことは引き継ぐ。

## Non-goals

- 文書ごとにEditorState、undo/redo、selectionを保持しない。
- メモとタスク以外の文書EditorStateを追加しない。
- タブやbrowser processの終了後に未送信本文を復元しない。
- 同一文書を複数ブラウザタブで同時編集しない。
- Pomodoro記録、割り込み記録、履歴詳細を文書同期へ統合しない。

## Decision

### EditorStateと画面タブ

一つのブラウザタブ内で、現在選択中のメモ用EditorStateを一つ、現在選択中のタスク用EditorStateを一つ保持する。両方が未送信本文を持つことを許容する。未送信本文の上限は文書数ではなく文書種類数により最大二つへ固定する。

メモ、タスク、記録、割り込み、履歴詳細の画面タブ切り替えは表示だけを変更する。画面タブ切り替えを理由に本文またはmetadataのサーバーACKを待たず、EditorState、dirty状態、保存timer、競合状態、編集権を変更しない。

同じ種類で別文書を選択し、EditorStateを差し替えるときは、その種類のdirty本文と未確認metadataのサーバーACKを待つ。保存失敗またはCAS拒否時は選択、URL、EditorStateを変更しない。他方の種類のEditorStateはこの遷移へ関与しない。

文書全体の再取得など、取得結果が両方のEditorStateへ影響する操作では、メモ用とタスク用の両方を固定し、dirty本文とmetadataのACKを確認してから取得結果を適用する。

### 保存とブラウザイベント

各EditorStateは表示状態に関係なく、最後の入力から15秒後に本文を保存する。ページが非表示になった場合、dirtyなメモとタスクはそれぞれ通常の保存経路をbest effortで開始する。この保存ではEditorStateを固定せず、同期状態を表示し、ページが再表示されたときも入力可能とする。送信中に追加入力された場合は、先行ACKでcleanにせず最新versionを後続保存する。

各EditorStateは表示状態に関係なく、dirtyまたは送信中なら`beforeunload`で警告する。metadata送信待ちはEditorStateに属さないglobal queueとして、別途保存、終了警告、エラー表示を担当する。

### 編集権

各種類のEditorStateは、選択中文書のWeb Lockを表示状態、dirty状態、送信状態に関係なく保持する。ロックは同じ種類の別文書を選択したとき、利用者が別ブラウザタブへ明示的に編集権を引き渡したとき、またはブラウザタブを終了したときに解放する。

明示的な引き渡しではdirty本文のサーバーACKを確認してからロックを解放する。別ブラウザタブで同じ文書を開いた場合、ロックを持たない側は読み取り専用とする。Web Locksが及ばない別browser profileと別端末からの古い保存は、引き続きサーバーのrevision CASで拒否する。

## Rejected alternatives

### 非表示になったときだけ保存してcleanにする

未送信本文を一つへ限定できるが、単なる画面切り替えでGASの応答待ちが発生し、保存と編集権の状態機械が表示状態へ依存する。EditorState数は最大二つへ固定されているため採用しない。

### dirtyな間だけ非表示文書のWeb Lockを保持する

clean化のたびにロックを解放すると、再表示時に再取得、再取得中の入力禁止、ロック再取得失敗を扱う必要がある。選択期間とロック期間を一致させる方が状態遷移を限定できるため採用しない。

### 画面タブ切り替え時にバックグラウンド保存を開始する

画面タブ切り替えが保存timerを操作し、表示状態と同期状態が再び結合する。各EditorStateの15秒保存とページ非表示時保存で十分なため採用しない。

## Consequences

### Positive

- 画面タブはdirty状態やGASの応答に関係なく即座に切り替わる。
- 保存、終了警告、競合、Web Lockの状態機械が画面の表示状態へ依存しない。
- メモとタスクを行き来してもEditorState、undo/redo、selectionを維持できる。
- 未送信本文の場所は最大二つの選択中EditorStateへ限定され、文書用IndexedDBとoutboxを必要としない。
- 非表示時のbest-effort保存中にページへ戻っても入力を継続できる。

### Negative

- 一つのブラウザタブでメモとタスクの未送信本文を同時に失い得る。
- 非表示のclean文書もWeb Lockを保持するため、別ブラウザタブで同じ文書を編集するには明示的な引き渡しが必要になる。
- ページ非表示時には最大二つの本文保存が並行して開始され得る。
- 非表示EditorStateで生じた保存失敗または競合は、その種類を再表示するまで詳細UIが見えない。

## Implementation

- 種類ごとのeditor mount境界: `client/components/layout/RightPanel.tsx`
- EditorState、保存、終了警告、Web Lock: `client/hooks/useDocumentEditor.ts`
- 種類ごとの文書遷移guard: `client/lib/documentNavigationGuard.ts`
- 画面タブと文書選択の遷移分離: `client/contexts/NavigationContext.tsx`, `client/hooks/useMemos.ts`, `client/hooks/useTasks.ts`
- サーバー確認済み文字列snapshot: `client/lib/documentStore.ts`

## Verification

- dirtyなメモからタスク、記録、履歴詳細へACK待ちなしで切り替えられる。
- メモとタスクが同時にdirtyでも、それぞれ15秒後に保存される。
- ページ非表示時に両方のdirty本文が通常保存され、保存中も編集可能である。
- 同じ種類の別文書への切り替えは、その種類の本文ACK前に確定しない。
- 非表示の選択中文書もWeb Lockを保持する。
- 別タブへの編集権移譲は本文ACK前に完了しない。
- どちらかのEditorStateがdirtyまたは送信中なら終了警告を出す。
- CAS拒否後もlocalとserverの両本文へ到達できる。
- 文書全体の再取得では両EditorStateを固定し、取得開始後の入力を上書きしない。
- `pnpm run format:check`
- `pnpm run typecheck`
- `pnpm run lint`
- `pnpm run test:unit`
- `pnpm run test:e2e`
- `pnpm run build:gas`
