import s from "./DocumentContentConflict.module.css";

export interface DocumentContentConflictValue {
  localContent: string;
  remoteContent: string;
  remoteRevision: number;
}

export function DocumentContentConflict({
  conflict,
  onKeepLocal,
  onAcceptRemote,
}: {
  conflict: DocumentContentConflictValue | null;
  onKeepLocal: () => Promise<void>;
  onAcceptRemote: () => Promise<void>;
}) {
  if (!conflict) return null;
  return (
    <section className={s.panel} role="alert" data-document-content-conflict>
      <strong>本文が別のタブまたは端末で更新されています</strong>
      <p>自動的には上書きしません。両方を確認して採用する本文を選んでください。</p>
      <div className={s.versions}>
        <label>
          このタブの本文
          <textarea readOnly value={conflict.localContent} />
        </label>
        <label>
          サーバーの本文
          <textarea readOnly value={conflict.remoteContent} />
        </label>
      </div>
      <div className={s.actions}>
        <button type="button" onClick={() => void onKeepLocal()}>
          このタブの本文で置換
        </button>
        <button type="button" onClick={() => void onAcceptRemote()}>
          サーバーの本文を採用
        </button>
      </div>
    </section>
  );
}
