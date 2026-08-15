# ADR 0001: 文書をサーバー確認済みメモリ状態から編集し、遷移前に保存する

- Status: Superseded by ADR 0002
- Superseded by: [ADR 0002](0002-keep-one-editor-state-per-document-type.md)
- Date: 2026-08-15
- Deciders: Repository owner

## Context

従来のクライアントは、EditorState、タブ内キャッシュ、IndexedDB entity、送信待ち状態をそれぞれ持ち、起動時にはIndexedDBとSpreadsheetの本文を解決していた。IndexedDBへ未送信本文を残せる一方、休眠した端末やタブのdirty値、応答喪失、後続編集、metadata更新を複数の状態から判断する必要があり、古い本文を新しいサーバー本文へ適用する経路を増やしていた。

このアプリは一人で利用し、複数端末を通常は同時に操作しない。初期化時のサーバー待ちは許容するが、取得済みの文書を切り替えるたびにGASを待つことは許容しない。タブやブラウザprocessの終了によってサーバー未送信の入力を失うことは許容する。一方、古い端末やタブが、別の端末で確認済みとなった新しい本文を上書きしてはならない。

GASとSpreadsheetには常時接続やpush通知がなく、ブラウザ終了時の非同期保存完了も保証できない。サーバーデータの保護は、ローカルキャッシュの鮮度ではなくSpreadsheet上のrevision CASで行う必要がある。

## Non-goals

- タブ、ブラウザprocess、端末を失った後の未送信本文を復元しない。
- CRDTまたは文字単位の共同編集を導入しない。
- 同一文書を複数タブで同時編集しない。
- カーソル、選択範囲、undo/redo履歴を文書切り替え後に維持しない。
- Pomodoroタイマー、作業記録、割り込み記録のIndexedDB利用を変更しない。
- 文書の並び順競合を検出または手動解決しない。
- サーバー更新を常時pollingしない。

## Decision

### 正本とクライアント状態

Spreadsheetを唯一の永続的な文書正本とする。メモ、プロジェクト、ケース、タスクのmetadata、本文、content revision、metadata revisionを初期化時に一括取得し、タブ内メモリへ保持する。文書entityと本文をIndexedDBへ保存せず、旧文書storeも通常処理から参照しない。

未選択文書は、最後にサーバーから取得またはACKされた完全な文字列snapshotとして保持する。選択中の一文書だけをEditorStateへ変換する。選択解除時は本文を文字列へ戻し、EditorStateを破棄する。EditorStateと別の可変Working本文を同時に正本として持たない。

初期取得に失敗した場合、未取得本文を空本文として編集可能にしない。アーカイブ済み文書は通常の初期一括取得から除外できるが、検索または直接参照時にサーバーから取得可能にする。

### 保存と文書遷移

本文は最後の入力から15秒後に保存する。連続入力に対する最大保存間隔は設けない。本文変更中にページが非表示になった場合は保存をbest effortで開始するが、完了を保証しない。

サーバーACK済みのclean文書からは即座に遷移する。dirty、送信中、保存失敗、競合状態の文書から別文書、別アプリタブ、別ウィンドウ、table view、archiveへ遷移するときは、最新EditorStateを固定して保存し、ACKを確認してから遷移を確定する。保存失敗またはCAS拒否時は遷移せず、現在のEditorStateを維持する。利用者が明示的に本文をコピーまたは破棄する操作は別途許可できる。

タブ内で未送信本文を持てるのは、現在選択中の文書だけとする。これにより、非表示文書ごとのoutbox、永続Draft、Recovery、EditorState cacheを持たない。

通常のbeforeunloadではdirty状態を警告するが、process終了後の復元を保証しない。未送信本文を持つタブを失った場合、最後のサーバーACK以降の入力は失われ得る。

### 競合制御

本文とmetadataは別のrevisionとmutation IDを持つ。

- 本文は`contentRevision`をbaseとするCASで保存する。
- 名前、status、タグ、色、日付、lifecycleはfield patchと`metadataRevision` CASで保存する。
- 並び順は現在の所属IDで正規化し、サーバー受理順のLWWとする。

GASはScript Lock内でrevision比較、対象フィールド更新、revision更新、最後のmutation ID記録を行う。同じmutation IDの再送は同じ成功として扱う。期待revisionが一致しない場合は現在のサーバーsnapshotを返し、クライアント本文を自動適用しない。

CAS拒否時はタブが生きている間、localとserverの両本文へ到達できる競合表示を行う。local採用は現在のserver revisionを明示的な新しいbaseとして再送し、server採用は利用者の操作後にだけEditorStateへ適用する。競合中のタブ終了ではlocal本文を失い得る。

### 複数タブと再取得

同一browser profileではWeb Locksを使い、一文書の本文編集権を一タブへ限定する。別タブへdirty文書の編集権を移す場合、元タブがサーバーACKを確認してからlockを解放する。Web Locks非対応時は別タブ編集機能を提供しない。

BroadcastChannelは、サーバー確認済みsnapshotまたは再取得要求の通知にだけ使う。安全性をBroadcastChannelの配送へ依存させない。別タブで選択中の文書についてもmetadata patchを許可し、本文revisionとは独立して適用する。

文書は次の場合にバックグラウンドで一括再取得する。

- 初回起動
- 30分以上非表示だったページの表示復帰
- offlineからonlineへの復帰
- 利用者の明示的な更新

通常の文書切り替えと短時間の表示復帰では再取得せず、定期pollingもしない。再取得結果はclean文書にだけ自動適用する。選択中のdirty文書でremote revisionが進んでいれば競合とし、取得開始後の入力を上書きしない。

### 切り替え

新clientへの切り替え前に旧clientの全タブと端末を閉じ、Spreadsheet上の値を確認する。旧文書IndexedDBは新clientから読み書きしないが、自動削除もしない。revisionを送らない旧本文・metadata更新をサーバー側で成功させない。作業記録用IndexedDBは維持する。

## Rejected alternatives

### IndexedDBを文書Working Storeにする

タブ終了後も未送信本文を復元できるが、dirty、送信中、後続編集、応答喪失、CAS拒否、複数タブtransaction、起動時reconcileを永続状態として管理する必要がある。許容されたクラッシュ損失に対して状態機械と復旧UIの負担が大きいため採用しない。

### メモリとIndexedDBの両方へWorking本文を持つ

通常の切り替えを高速化できるが、どちらが最新かをlocal versionとACKごとに解決する必要がある。二つの可変なクライアント正本を作るため採用しない。

### dirty文書から先に画面遷移してバックグラウンド保存する

操作は速いが、複数の非表示文書が未送信状態になり、タブ内outboxと複数EditorStateまたはserialized Draftを必要とする。保存ACK後に遷移することで、未送信本文を選択中の一文書へ限定する。

### 常時manifest pollingを行う

別端末の反映は速くなるが、通常は複数端末を同時使用せず、CASが古い保存を拒否する。GAS呼び出しと状態適用経路を増やすため採用しない。

## Consequences

### Positive

- 文書用IndexedDBのmerge、outbox、migration、Recovery状態機械を削除できる。
- 未送信本文の場所を選択中EditorStateだけに限定できる。
- 取得済みclean文書はネットワーク待ちなしで切り替えられる。
- 古い端末やタブはCAS拒否され、サーバー本文を破壊しない。
- 同一ブラウザの別タブ編集と複数端末の安全性を同じCASで担保できる。

### Negative

- タブまたはprocess終了時に、最後のACK以降の本文と未解決競合を失い得る。
- 入力直後の文書切り替え、別タブ移譲、archiveはGASの応答を待つ。
- 文書切り替えでundo/redo履歴、selection、editor pluginの一時状態を失う。
- オフライン中はdirty文書から安全に遷移できない。
- 初期取得に失敗した場合は文書を編集できない。

## Implementation

- 初期loadと再取得: `client/contexts/AppContext.tsx`, `src/Code.ts`
- メモリ文書repository: `client/lib/documentStore.ts`
- EditorStateと保存境界: `client/hooks/useDocumentEditor.ts`
- 文書選択guard: `client/lib/documentNavigationGuard.ts`
- memo/task facade: `client/lib/memoStore.ts`, `client/lib/taskStore.ts`
- 複数タブ表示と編集権: `client/lib/documentWindow.ts`
- GAS CAS: `src/DocumentSyncService.ts`

## Verification

- clean文書の切り替えがサーバー呼び出しを発生させない。
- dirty文書はACK前に選択、URL、EditorStateを切り替えない。
- 保存失敗またはCAS拒否後も現在のEditorStateを維持する。
- ACKより新しい入力を古いACKでcleanにしない。
- 古いrevisionの本文・metadata patchがSpreadsheetを変更しない。
- 同じmutation IDの再送でrevisionを二重に進めない。
- 別タブへの編集権移譲がACK前に完了しない。
- 30分以上の非表示復帰ではclean文書だけを更新する。
- archive前の本文保存失敗で文書をarchiveしない。
- 旧文書IndexedDBを初期loadおよび通常操作で参照しない。
- `python3 .agents/skills/create-adr/scripts/check_adrs.py --adr-dir docs/adr`
- `pnpm run format:check`
- `pnpm run typecheck`
- `pnpm run lint`
- `pnpm run test:unit`
- `pnpm run test:e2e`
- `pnpm run build:gas`
