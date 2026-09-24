/**
 * Toast store — module-level so both components and non-React stores can report results.
 * Rendered by <ToastViewport /> (components/shared/Toast.tsx).
 */

export type ToastKind = "info" | "error";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface Toast {
  id: number;
  message: string;
  kind: ToastKind;
  action?: ToastAction;
  durationMs: number;
}

export interface ToastOptions {
  message: string;
  kind?: ToastKind;
  action?: ToastAction;
  durationMs?: number;
}

const MAX_TOASTS = 4;

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((listener) => listener());
}

export function showToast(options: ToastOptions): number {
  const kind = options.kind ?? "info";
  const toast: Toast = {
    id: nextId++,
    message: options.message,
    kind,
    action: options.action,
    durationMs: options.durationMs ?? (kind === "error" ? 8000 : 5000),
  };
  toasts = [...toasts, toast].slice(-MAX_TOASTS);
  emit();
  return toast.id;
}

/** Report a failed operation. `retry` adds a 再試行 action. */
export function showErrorToast(message: string, retry?: () => void): number {
  return showToast({
    message,
    kind: "error",
    action: retry ? { label: "再試行", onClick: retry } : undefined,
  });
}

export function dismissToast(id: number): void {
  if (!toasts.some((toast) => toast.id === id)) return;
  toasts = toasts.filter((toast) => toast.id !== id);
  emit();
}

export function subscribeToasts(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getToasts(): Toast[] {
  return toasts;
}

/** Human-readable message for an unknown thrown value. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
