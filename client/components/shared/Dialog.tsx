/**
 * Dialog — shared modal shell plus confirm / text-input dialogs.
 * Replaces native confirm() / prompt() so every confirmation looks and behaves the same.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import s from "./Dialog.module.css";

export function DialogShell({
  title,
  onCancel,
  children,
  actions,
  dismissible = true,
}: {
  title: string;
  onCancel: () => void;
  children?: ReactNode;
  actions: ReactNode;
  /** When false, Escape and backdrop clicks are ignored (e.g. while saving). */
  dismissible?: boolean;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    const initial =
      dialog?.querySelector<HTMLElement>("[data-autofocus]") ??
      dialog?.querySelector<HTMLElement>("input, button:not(:disabled)");
    initial?.focus();
    return () => previousFocus?.focus();
  }, []);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    // Keep keys from reaching global shortcuts (e.g. Escape closing the search palette).
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      if (dismissible) onCancel();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      className={s.backdrop}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && dismissible) onCancel();
      }}
    >
      <section
        ref={dialogRef}
        className={s.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={handleKeyDown}
      >
        <h2 id={titleId} className={s.title}>
          {title}
        </h2>
        {children && <div className={s.body}>{children}</div>}
        <div className={s.actions}>{actions}</div>
      </section>
    </div>
  );
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel = "キャンセル",
  danger = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  message?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <DialogShell
      title={title}
      onCancel={onCancel}
      actions={
        <>
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`btn ${danger ? "btn-danger" : "btn-primary"}`}
            onClick={onConfirm}
            data-autofocus
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      {message && <p className={s.message}>{message}</p>}
    </DialogShell>
  );
}

export function TextInputDialog({
  title,
  label,
  confirmLabel,
  initialValue = "",
  onSubmit,
  onCancel,
}: {
  title: string;
  label: string;
  confirmLabel: string;
  initialValue?: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}) {
  const inputId = useId();
  const [value, setValue] = useState(initialValue);
  const trimmed = value.trim();
  const submit = () => {
    if (trimmed) onSubmit(trimmed);
  };

  return (
    <DialogShell
      title={title}
      onCancel={onCancel}
      actions={
        <>
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            キャンセル
          </button>
          <button type="button" className="btn btn-primary" onClick={submit} disabled={!trimmed}>
            {confirmLabel}
          </button>
        </>
      }
    >
      <label className={s.field} htmlFor={inputId}>
        <span>{label}</span>
        <input
          id={inputId}
          type="text"
          value={value}
          autoComplete="off"
          data-autofocus
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.nativeEvent.isComposing) {
              event.preventDefault();
              submit();
            }
          }}
        />
      </label>
    </DialogShell>
  );
}
