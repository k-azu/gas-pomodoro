import { useEffect, useState } from "react";
import * as EntityStore from "../../lib/entityStore";
import s from "./RecoveryDraftPanel.module.css";

const STORE_LABELS: Record<string, string> = {
  memos: "メモ",
  projects: "プロジェクト",
  cases: "ケース",
  tasks: "タスク",
};

function recoveryMessage(draft: EntityStore.RecoveryDraft): string {
  if (draft.recoveryState === "conflicting") return "別の下書きとの競合";
  if (draft.recoveryReason === "inactive") return "アーカイブ済みの文書";
  return "削除済みの文書";
}

export function RecoveryDraftPanel() {
  const [drafts, setDrafts] = useState<EntityStore.RecoveryDraft[]>([]);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const refresh = () => {
      void EntityStore.getRecoveryDrafts()
        .then((next) => {
          if (active) setDrafts(next);
        })
        .catch((error) => console.error("[RecoveryDraftPanel] Failed to load drafts:", error));
    };
    refresh();
    EntityStore.on("recoveryDraftsChanged", refresh);
    return () => {
      active = false;
      EntityStore.off("recoveryDraftsChanged", refresh);
    };
  }, []);

  if (drafts.length === 0) return null;

  const copy = async (draft: EntityStore.RecoveryDraft) => {
    try {
      await navigator.clipboard.writeText(draft.content);
      setCopiedKey(draft.key);
    } catch (error) {
      console.error("[RecoveryDraftPanel] Failed to copy draft:", error);
    }
  };

  const discard = async (draft: EntityStore.RecoveryDraft) => {
    if (!window.confirm("この回復用の本文を完全に破棄しますか？")) return;
    await EntityStore.discardRecoveryDraft(draft.key);
  };

  return (
    <aside className={s.panel} aria-label="回復用の本文">
      <h2>回復用の本文 ({drafts.length})</h2>
      <p className={s.description}>保存できなかった本文です。必要な内容をコピーしてください。</p>
      <div className={s.list}>
        {drafts.map((draft) => (
          <details className={s.draft} key={draft.key}>
            <summary>
              {STORE_LABELS[draft.storeName] || draft.storeName} · {recoveryMessage(draft)}
            </summary>
            <div className={s.meta}>{new Date(draft.dirtyAt).toLocaleString()}</div>
            <pre>{draft.content}</pre>
            <div className={s.actions}>
              <button type="button" onClick={() => void copy(draft)}>
                {copiedKey === draft.key ? "コピーしました" : "本文をコピー"}
              </button>
              <button className={s.discard} type="button" onClick={() => void discard(draft)}>
                破棄
              </button>
            </div>
          </details>
        ))}
      </div>
    </aside>
  );
}
