# ADR 0004: タスク文書のアーカイブを可視性属性として扱う

- Status: Accepted
- Date: 2026-08-15
- Deciders: Repository owner

## Context

プロジェクト、ケース、タスクの`isActive`は、通常のサイドバーやタスク一覧から文書を除外するために使われている。一方、従来は同じ値を文書の編集禁止にも使い、アーカイブ済み文書への本文保存を存在しない文書として拒否し、metadata更新も復元以外は拒否していた。クライアントもEditorStateを読み取り専用にし、Web Lock、新しいタブ、metadata編集、作業記録表示を無効にしていた。

この扱いでは、別タブが選択中の文書をアーカイブすると、そのタブに残る未送信本文が保存不能になる。アーカイブ前の本文保存、読み取り専用への遷移、競合時の回収、親子文書の一括更新という専用経路も必要になる。

このアプリにおけるアーカイブの目的は、保存済み文書の改変を禁止することではなく、普段使う一覧を整理することである。Spreadsheet上の行とrevision CASはアーカイブ後も維持されるため、可視性と編集可否を結合する必要はない。

## Non-goals

- 文書を物理削除する仕組みを追加しない。
- 改変禁止の履歴または監査用snapshotを追加しない。
- アーカイブ済み文書を通常のサイドバーやタスク一覧へ表示しない。
- 文書検索からアーカイブ済み文書を除外しない。
- 並び順の競合方式を変更しない。
- メモのアーカイブと復元の挙動を変更しない。

## Decision

プロジェクト、ケース、タスクの`isActive`を通常ナビゲーション上の可視性を表すmetadataとして扱う。`isActive`が`false`でも、文書は存在し、本文、名前、色、status、日付を通常文書と同じrevision CAS、mutation ID、再送処理で読み書きできる。

クライアントはアーカイブ済みであることだけを理由にEditorStateを読み取り専用にせず、Web Lock、別タブへの編集権移譲、競合UI、作業記録を通常文書と同じように扱う。通常一覧では非表示にし、検索結果、アーカイブ一覧、選択中EditorStateではアーカイブ済みであることを表示する。

プロジェクトまたはケースをアーカイブするとき、子の`isActive`は変更しない。通常一覧での実効的な可視性は、自身と祖先がすべてactiveである場合に限る。親を復元したとき、個別にアーカイブされていない子は再び表示され、個別にアーカイブされた子は非表示のままとする。

サーバーは、実在する非activeなプロジェクト、ケース、タスクへの本文・metadata更新を`missing`または`rejected`にしない。これらの文書では`missing`は行が存在しない場合だけを表す。アーカイブ、復元、アーカイブ中の編集は互いに独立した通常のmetadataまたは本文mutationとして競合・再送する。

物理削除または改変禁止が将来必要になった場合、`isActive`へ意味を追加せず、別のlifecycle状態と保存契約として設計する。

## Rejected alternatives

### アーカイブ済み文書を読み取り専用にする

保存後の内容を固定できるが、このアプリでは監査用の不変履歴を必要としない。別タブのアーカイブによって未送信本文が保存不能になり、可視性変更のために専用の回収経路が必要になるため採用しない。

### 親のアーカイブを子へ伝播する

各行の`isActive`だけで表示判定できるが、親子の複数mutationが途中失敗する状態と、復元時に個別アーカイブを区別する処理が必要になる。祖先を含む実効可視性をFEと検索で判定する方がmutation数と中間状態を減らせるため採用しない。

### アーカイブ時に選択中EditorStateを閉じる

通常一覧との表示は一致するが、dirty本文のACK待ちと次文書選択がアーカイブ操作へ結合する。選択中EditorStateは表示一覧と独立して保持できるため採用しない。

## Consequences

### Positive

- 別タブでアーカイブされても、未送信本文を通常のCASで保存できる。
- サーバーの`missing`が文書の不存在だけを表し、復旧判断が明確になる。
- アーカイブ専用の読み取り専用、編集権、本文保存、親子一括更新を削除できる。
- 親のアーカイブと復元が一つのmetadata mutationで完了する。
- 親の復元で、子が個別にアーカイブされていた事実を失わない。

### Negative

- アーカイブ済み文書は検索またはアーカイブ一覧から開いて変更できるため、アーカイブを改変禁止と見なすことはできない。
- タスク一覧の可視性判定にはProject、Case、Taskの関係が必要になる。
- 選択中の文書をアーカイブした直後は、サイドバーに存在しない文書をEditorStateが表示し続ける。

## Implementation

- 文書CAS: `src/DocumentSyncService.ts`
- task階層の可視性とarchive facade: `client/lib/taskStore.ts`
- 選択中EditorStateとarchive表示: `client/components/task/TaskContent.tsx`
- archive操作と一覧反映: `client/hooks/useTasks.ts`
- 検索上の実効可視性: `src/DocumentSearchService.ts`

## Verification

- アーカイブ済みのプロジェクト、ケース、タスクの本文とmetadataをrevision CASで更新できる。
- 別タブがdirtyな選択中文書をアーカイブしても、EditorStateと編集権を維持する。
- アーカイブ済み文書を通常一覧へ表示せず、検索とアーカイブ一覧から編集できる。
- 親のアーカイブで子の`isActive`を変更しない。
- 親が非activeならactiveな子も通常一覧へ表示しない。
- 親の復元で個別に非activeな子を復元しない。
- CAS拒否、応答喪失、再読込後も本文とmetadataが収束する。
- `python3 .agents/skills/create-adr/scripts/check_adrs.py --adr-dir docs/adr`
- `pnpm run format:check`
- `pnpm run typecheck`
- `pnpm run lint`
- `pnpm run test:unit`
- `pnpm run test:e2e`
- `pnpm run build:gas`
