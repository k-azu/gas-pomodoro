import { useEffect, useSyncExternalStore } from "react";
import { dismissToast, getToasts, subscribeToasts, type Toast } from "../../lib/toast";
import s from "./Toast.module.css";

export function ToastViewport() {
  const toasts = useSyncExternalStore(subscribeToasts, getToasts);
  if (toasts.length === 0) return null;
  return (
    <div className={s.viewport}>
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} />
      ))}
    </div>
  );
}

function ToastItem({ toast }: { toast: Toast }) {
  useEffect(() => {
    const timer = window.setTimeout(() => dismissToast(toast.id), toast.durationMs);
    return () => window.clearTimeout(timer);
  }, [toast.id, toast.durationMs]);

  return (
    <div
      className={s.toast}
      data-kind={toast.kind}
      role={toast.kind === "error" ? "alert" : "status"}
    >
      <span className={s.message}>{toast.message}</span>
      {toast.action && (
        <button
          type="button"
          className={s.action}
          onClick={() => {
            dismissToast(toast.id);
            toast.action?.onClick();
          }}
        >
          {toast.action.label}
        </button>
      )}
      <button
        type="button"
        className={s.close}
        onClick={() => dismissToast(toast.id)}
        aria-label="閉じる"
      >
        ×
      </button>
    </div>
  );
}
