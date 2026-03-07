import s from "./SyncIndicator.module.css";

export type SyncStatus = "idle" | "syncing" | "synced" | "error";

export function SyncIndicator({ status }: { status: SyncStatus }) {
  if (status === "idle" || status === "synced") return null;

  return (
    <span className={s["sync-indicator"]} data-status={status}>
      {status === "syncing" && (
        <>
          <span className={s["spinner"]} />
          同期中...
        </>
      )}
      {status === "error" && "同期エラー"}
    </span>
  );
}
