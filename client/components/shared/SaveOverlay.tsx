import s from "./SaveOverlay.module.css";

export function SaveOverlay({
  visible,
  label = "保存中...",
}: {
  visible: boolean;
  label?: string;
}) {
  if (!visible) return null;
  return (
    <div className={s["overlay"]} role="status" aria-live="polite">
      <div className={s["spinner"]} />
      <span className={s["label"]}>{label}</span>
    </div>
  );
}
