# Architecture Decision Records

このディレクトリは、長期的な設計判断とその理由を履歴として保存する。実装手順や一時的な検証結果はADRへ記録しない。

| ADR                                                                      | Status                 | Decision                                                     |
| ------------------------------------------------------------------------ | ---------------------- | ------------------------------------------------------------ |
| [0001](0001-use-server-confirmed-memory-document-state.md)               | Superseded by ADR 0002 | 文書をサーバー確認済みメモリ状態から編集し、遷移前に保存する |
| [0002](0002-keep-one-editor-state-per-document-type.md)                  | Superseded by ADR 0003 | メモとタスクでEditorStateを一つずつ保持する                  |
| [0003](0003-keep-selected-document-editors-independent-of-visibility.md) | Accepted               | 選択中のメモ・タスクを表示状態と独立して保持する             |
