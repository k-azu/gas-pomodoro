import s from "./SaveOverlay.module.css";

export function SaveOverlay({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <div className={s["overlay"]}>
      <div className={s["spinner"]} />
      <span className={s["label"]}>保存中...</span>
    </div>
  );
}
