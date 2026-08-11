import { useEffect, useState } from "react";
import {
  publishRecoveryInvalidation,
  subscribeRecoveryInvalidation,
} from "../../lib/documentInvalidation";
import {
  discardRecoveryDocumentDraft,
  getRecoveryDocumentDrafts,
} from "../../lib/documentRepository";
import type { RecoveryDocumentDraft } from "../../lib/documentContentModel";
import s from "./RecoveryDraftPanel.module.css";

const STORE_LABELS: Record<string, string> = {
  memos: "メモ",
  projects: "プロジェクト",
  cases: "ケース",
  tasks: "タスク",
};

function recoveryMessage(draft: RecoveryDocumentDraft): string {
  if (draft.reason === "superseded") return "別の下書きとの競合";
  if (draft.reason === "inactive") return "アーカイブ済みの文書";
  return "削除済みの文書";
}

export function RecoveryDraftPanel() {
  const [drafts, setDrafts] = useState<RecoveryDocumentDraft[]>([]);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const refresh = () => {
      void getRecoveryDocumentDrafts()
        .then((next) => {
          if (active) setDrafts(next);
        })
        .catch((error) => console.error("[RecoveryDraftPanel] Failed to load drafts:", error));
    };
    refresh();
    const unsubscribe = subscribeRecoveryInvalidation(refresh);
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  if (drafts.length === 0) return null;

  const copy = async (draft: RecoveryDocumentDraft) => {
    try {
      await navigator.clipboard.writeText(draft.content);
      setCopiedKey(draft.recoveryId);
    } catch (error) {
      console.error("[RecoveryDraftPanel] Failed to copy draft:", error);
    }
  };

  const discard = async (draft: RecoveryDocumentDraft) => {
    if (!window.confirm("この回復用の本文を完全に破棄しますか？")) return;
    await discardRecoveryDocumentDraft(draft.recoveryId);
    publishRecoveryInvalidation();
  };

  return (
    <aside className={s.panel} aria-label="回復用の本文">
      <h2>回復用の本文 ({drafts.length})</h2>
      <p className={s.description}>保存できなかった本文です。必要な内容をコピーしてください。</p>
      <div className={s.list}>
        {drafts.map((draft) => {
          const [storeName] = draft.documentKey.split(":");
          return (
            <details className={s.draft} key={draft.recoveryId}>
              <summary>
                {STORE_LABELS[storeName] || storeName} · {recoveryMessage(draft)}
              </summary>
              <div className={s.meta}>{new Date(draft.createdAt).toLocaleString()}</div>
              <pre>{draft.content}</pre>
              <div className={s.actions}>
                <button type="button" onClick={() => void copy(draft)}>
                  {copiedKey === draft.recoveryId ? "コピーしました" : "本文をコピー"}
                </button>
                <button className={s.discard} type="button" onClick={() => void discard(draft)}>
                  破棄
                </button>
              </div>
            </details>
          );
        })}
      </div>
    </aside>
  );
}
