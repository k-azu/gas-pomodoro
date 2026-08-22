import { useEffect, useId, useRef, useState } from "react";
import s from "./CreateDocumentModal.module.css";

export type CreateDocumentType = "memo" | "project" | "case" | "task";

const TYPE_LABELS: Record<CreateDocumentType, string> = {
  memo: "メモ",
  project: "プロジェクト",
  case: "ケース",
  task: "タスク",
};

export function CreateDocumentModal({
  title,
  allowedTypes,
  onClose,
  onSubmit,
}: {
  title: string;
  allowedTypes: CreateDocumentType[];
  onClose: () => void;
  onSubmit: (type: CreateDocumentType, name: string) => Promise<void>;
}) {
  const titleId = useId();
  const nameId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const [name, setName] = useState("");
  const [submittingType, setSubmittingType] = useState<CreateDocumentType | null>(null);
  const [error, setError] = useState("");
  const submitting = submittingType !== null;

  useEffect(() => {
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    nameInputRef.current?.focus();
    return () => previousFocusRef.current?.focus();
  }, []);

  const close = () => {
    if (!submitting) onClose();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
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

  const submit = async (type: CreateDocumentType) => {
    const trimmedName = name.trim();
    if (!trimmedName || submitting) return;

    setSubmittingType(type);
    setError("");
    try {
      await onSubmit(type, trimmedName);
      onClose();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "作成に失敗しました");
      setSubmittingType(null);
    }
  };

  const fixedType = allowedTypes.length === 1 ? allowedTypes[0] : null;
  const nameLabel = fixedType ? `${TYPE_LABELS[fixedType]}名` : "名前";

  return (
    <div
      className={s.backdrop}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
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
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (fixedType) void submit(fixedType);
          }}
        >
          <header className={s.header}>
            <h2 id={titleId}>{title}</h2>
            <button
              type="button"
              className={s.close}
              onClick={close}
              disabled={submitting}
              aria-label="閉じる"
            >
              ×
            </button>
          </header>

          <div className={s.body}>
            <label className={s.field} htmlFor={nameId}>
              <span>{nameLabel}</span>
              <input
                ref={nameInputRef}
                id={nameId}
                type="text"
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  setError("");
                }}
                disabled={submitting}
                autoComplete="off"
                required
              />
            </label>

            {error && (
              <p className={s.error} role="alert">
                {error}
              </p>
            )}
          </div>

          <footer className={s.actions}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={close}
              disabled={submitting}
            >
              キャンセル
            </button>
            {fixedType ? (
              <button
                type="submit"
                className="btn btn-primary"
                disabled={!name.trim() || submitting}
              >
                {submitting ? "作成中..." : "作成"}
              </button>
            ) : (
              <div className={s["create-actions"]}>
                {allowedTypes.map((type) => (
                  <button
                    key={type}
                    type="button"
                    className="btn btn-primary"
                    disabled={!name.trim() || submitting}
                    onClick={() => void submit(type)}
                  >
                    {submittingType === type ? "作成中..." : `${TYPE_LABELS[type]}作成`}
                  </button>
                ))}
              </div>
            )}
          </footer>
        </form>
      </section>
    </div>
  );
}
