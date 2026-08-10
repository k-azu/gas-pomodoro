import s from "./SyncIndicator.module.css";

export type SyncStatus = "idle" | "syncing" | "synced" | "conflict" | "error";

export function SyncIndicator({
  status,
  onAcceptRemote,
  onKeepLocal,
}: {
  status: SyncStatus;
  onAcceptRemote: () => void;
  onKeepLocal: () => void;
}) {
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
      {status === "conflict" && (
        <>
          <span>別のタブで更新されました</span>
          <button type="button" onClick={onAcceptRemote}>
            最新版を反映
          </button>
          <button type="button" onClick={onKeepLocal}>
            この内容を保存
          </button>
        </>
      )}
    </span>
  );
}
