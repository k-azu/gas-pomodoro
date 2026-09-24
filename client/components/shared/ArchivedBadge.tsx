import s from "./ArchivedBadge.module.css";

/**
 * ArchivedBadge — "アーカイブ済み" label shown in a document's meta row.
 * Archived documents stay editable (ADR 0004 / 0005); `onRestore` adds the unarchive action.
 */
export function ArchivedBadge({
  label = "アーカイブ済み",
  title,
  onRestore,
}: {
  label?: string;
  /** Tooltip explaining why the document is treated as archived */
  title?: string;
  onRestore?: () => void;
}) {
  return (
    <span className={s.container} title={title}>
      <span className={s.label}>{label}</span>
      {onRestore && (
        <button type="button" className={s.restore} onClick={onRestore}>
          アーカイブを解除
        </button>
      )}
    </span>
  );
}
