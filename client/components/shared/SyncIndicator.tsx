import s from "./SyncIndicator.module.css";

export type SyncStatus = "idle" | "loading" | "syncing" | "synced" | "error" | "locked";

export function SyncIndicator({ status, onRetry }: { status: SyncStatus; onRetry?: () => void }) {
  if (status === "idle" || status === "loading") return null;

  return (
    <span className={s["sync-indicator"]} data-status={status}>
      {status === "syncing" && (
        <>
          <span className={s["spinner"]} />
          同期中...
        </>
      )}
      {status === "synced" && "保存済み"}
      {status === "error" && (
        <>
          <span>同期エラー</span>
          {onRetry && (
            <button type="button" className={s.retry} onClick={onRetry}>
              再試行
            </button>
          )}
        </>
      )}
      {status === "locked" && "別タブで本文編集中"}
    </span>
  );
}
