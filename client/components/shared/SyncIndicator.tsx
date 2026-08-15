import s from "./SyncIndicator.module.css";

export type SyncStatus = "idle" | "loading" | "syncing" | "synced" | "error" | "locked";

export function SyncIndicator({ status }: { status: SyncStatus }) {
  if (status === "idle" || status === "loading" || status === "synced") return null;

  return (
    <span className={s["sync-indicator"]} data-status={status}>
      {status === "syncing" && (
        <>
          <span className={s["spinner"]} />
          同期中...
        </>
      )}
      {status === "error" && "同期エラー"}
      {status === "locked" && "別タブで本文編集中"}
    </span>
  );
}
