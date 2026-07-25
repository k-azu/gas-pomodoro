import type { DocumentSearchNavigationController } from "../../hooks/useDocumentSearchNavigation";
import s from "./DocumentSearchNavigation.module.css";

export function DocumentSearchNavigation({
  controller,
}: {
  controller: DocumentSearchNavigationController;
}) {
  const hasMultipleMatches = controller.count > 1;

  return (
    <div className={s.bar} role="search" aria-label="本文内の検索結果">
      <span className={s.label}>本文内検索</span>
      <span className={s.query} title={controller.query}>
        {controller.query}
      </span>
      <span className={`${s.count}${controller.count === 0 ? ` ${s.empty}` : ""}`}>
        {controller.count > 0 ? `${controller.activeIndex + 1} / ${controller.count}` : "一致なし"}
      </span>
      <span className={s.actions}>
        <button
          type="button"
          className={s.button}
          onClick={controller.previous}
          disabled={!hasMultipleMatches}
          aria-label="前の一致箇所"
          title="前の一致箇所"
        >
          ↑
        </button>
        <button
          type="button"
          className={s.button}
          onClick={controller.next}
          disabled={!hasMultipleMatches}
          aria-label="次の一致箇所"
          title="次の一致箇所"
        >
          ↓
        </button>
        <span className={s.divider} />
        <button
          type="button"
          className={`${s.button} ${s.close}`}
          onClick={controller.close}
          aria-label="本文内検索を終了"
          title="本文内検索を終了"
        >
          ×
        </button>
      </span>
    </div>
  );
}
