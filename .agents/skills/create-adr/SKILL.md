---
name: create-adr
description: Create and maintain Architecture Decision Records (ADRs) from repository evidence. Use when Codex must decide whether a consequential architecture change needs an ADR, create a new ADR, supersede an accepted ADR, preserve rejected alternatives and trade-offs, or update an ADR index without turning ADRs into mutable implementation documentation.
---

# Create ADR

設計判断を、後から理由と制約を再現できる履歴として記録する。既存リポジトリの規約を優先し、規約がなければ `docs/adr/` と4桁の連番を使う。

## Workflow

### 1. リポジトリの規約と事実を確認する

- `AGENTS.md`、既存ADR、ADR index、README、関連コード、テスト、現在の差分を読む。
- `docs/adr/`、`doc/adr/`、`adr/` の順に決め打ちせず検索する。
- ユーザーが比較対象を指定した場合だけ、対象ブランチや履歴との差分を調べる。
- 推測を事実として書かない。未確定事項は `Proposed` または明示した仮定として残す。

### 2. ADRにするか判定する

次のいずれかに当たる判断だけをADRにする。

- 複数コンポーネントへ影響する責務境界、正本、データモデル、通信方式を決める。
- データ保護、整合性、可用性、セキュリティ、運用コストに長期的な制約を置く。
- 複数の妥当な代替案があり、採用理由を将来再検討する価値がある。
- 既存のAccepted ADRを置き換える。

既存方針内のバグ修正、局所的リファクタリング、一時的な実装メモ、進捗報告はADRにしない。必要ならコードコメント、issue、テスト、通常の設計文書を使う。

### 3. 新規作成か置換かを決める

- 新しい判断: 新しいADRを作成する。
- `Proposed`の判断を詰める: 同じADRを編集してよい。
- `Accepted`の誤字やリンク切れ: 判断を変えない最小修正だけ行う。
- `Accepted`の判断を変更: 本文を現状に合わせて書き換えず、新しいADRを作り、旧ADRを `Superseded by ADR NNNN` にして相互リンクする。
- 採用しない提案: 履歴を残す価値があれば `Rejected`、なければADRを作らない。

既存規約がなければ、状態は `Proposed`、`Accepted`、`Rejected`、`Deprecated`、`Superseded by ADR NNNN` を使う。

### 4. 採番して雛形を作る

既存規約が `docs/adr/NNNN-slug.md` なら、次のコマンドで衝突を避けて雛形を生成する。

```bash
python3 .agents/skills/create-adr/scripts/new_adr.py \
  --adr-dir docs/adr \
  --title "判断を表す短い題名" \
  --slug short-kebab-case
```

最初はプレビューだけを表示する。内容とパスを確認後、同じコマンドへ `--write` を追加する。既存ファイルは上書きしない。規約が異なる場合はスクリプトを使わず、その規約に従う。

### 5. 判断を記述する

`assets/adr-template.md` の構造を基準に、次を満たす。

- Title: 実装名ではなく、選んだ判断を能動形で表す。
- Context: 解く問題、制約、判断を迫った事実を記す。結論を先取りしない。
- Non-goals: 意図的に扱わない範囲を明確にする。
- Decision: 正本、責務境界、不変条件、失敗時の挙動、競合解決など、将来の実装を拘束する内容を書く。
- Rejected alternatives: 現実的だった案と、今回採らなかった理由を書く。弱い案を捏造しない。
- Consequences: 利点だけでなく、複雑性、運用負荷、移行、残るリスクを書く。
- Implementation: 判断を実現する入口だけを相対パスで示す。変わりやすい行番号や全ファイル一覧は避ける。
- Verification: 判断の不変条件を検証するテスト、観測項目、実行コマンドを書く。テスト件数、実行日時、成否など陳腐化する実行結果や、現在の状態に見えるチェック済み項目はADRへ固定せず、CIやコミット履歴に残す。

コードの現状説明ではなく「なぜこの制約を選んだか」を中心にする。要件、判断、実装詳細を混ぜない。

### 6. 関連箇所を整合させる

- ADR indexがあれば、新しい行と状態を追加する。
- 置換時は新旧ADRを相互リンクし、indexの旧状態も更新する。
- READMEやコードにアーキテクチャ文書への入口が必要なら、最小限のリンクを追加する。
- ADRと実装の用語、対象範囲、ファイル参照が一致することを確認する。
- ADRだけを変更する依頼では、実装まで変更しない。

### 7. 検証して報告する

- `python3 .agents/skills/create-adr/scripts/check_adrs.py --adr-dir <dir>` を実行する。
- Markdown formatterやリンク検査が既存コマンドにあれば実行する。
- `git diff --check` と差分レビューで、採用済み判断の意図しない書き換えがないか確認する。
- 作成/置換したADR、状態、重要な未決事項、この作業で実行した検証を簡潔に報告する。実行結果は作業報告に記し、ADR本文へ転記しない。

ADRの作成自体は設計の承認を意味しない。ユーザーが判断を確定していない場合は `Proposed` のままにする。
