/**
 * RecordRow — Shared record/interruption row components.
 * Extracted from HistoryList for reuse in TaskWorkRecords.
 */
import type { PomodoroRecord, InterruptionRecord, CategoryItem } from "../../types";
import type { ViewerState } from "../../contexts/NavigationContext";
import s from "./RecordRow.module.css";

// =========================================================
// CategoryBadge
// =========================================================

export function CategoryBadge({ name, color }: { name?: string; color?: string }) {
  if (!name) return <span className={s["record-badge"]} />;

  const style: React.CSSProperties = {};
  if (color) {
    style.background = color + "22";
    style.color = color;
    style.borderColor = color + "44";
  }

  return (
    <span className={s["record-badge"]} style={style}>
      <span
        className={s["record-badge-dot"]}
        style={{ background: color || "var(--text-secondary)" }}
      />
      {name}
    </span>
  );
}

// =========================================================
// RecordRow
// =========================================================

export function RecordRow({
  record: r,
  interruptions,
  colorMap,
  intCategories,
  showViewer,
}: {
  record: PomodoroRecord;
  interruptions: InterruptionRecord[];
  colorMap: Record<string, string>;
  intCategories: CategoryItem[];
  showViewer: (state: ViewerState) => void;
}) {
  const catColor = r.category ? colorMap[r.category] : undefined;
  const firstLine = (r.description || "")
    .split("\n")[0]
    .replace(/&nbsp;/g, " ")
    .trim();
  const durMin = Math.floor(r.actualDurationSeconds / 60);
  const intCount = r.workInterruptions + r.nonWorkInterruptions;

  let startStr = "";
  try {
    const d = new Date(r.startTime);
    startStr =
      String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  } catch {
    /* ignore */
  }

  const meta = `${startStr} ${durMin}分${intCount > 0 ? "/" + intCount + "中断" : ""}`;

  return (
    <li className={s["record-item"]}>
      <div
        className={s["record-item-row"]}
        onClick={() =>
          showViewer({
            markdown: (r.description || "").trim(),
            recordId: r.id,
            recordType: "record",
            category: r.category || "",
            sheetType: "Categories",
            interruptionType: null,
            startTime: r.startTime,
            endTime: r.endTime,
            projectId: r.projectId || "",
            caseId: r.caseId || "",
            taskId: r.taskId || "",
            actualDurationSeconds: r.actualDurationSeconds,
          })
        }
      >
        <CategoryBadge name={r.category} color={catColor} />
        <span className={s["record-desc"]}>{firstLine || "(無題)"}</span>
        <span className={s["record-meta"]}>{meta}</span>
      </div>
      {interruptions.length > 0 && (
        <div className={s["record-detail"]}>
          {interruptions.map((int) => (
            <InterruptionRow
              key={int.id}
              int={int}
              intCategories={intCategories}
              showViewer={showViewer}
            />
          ))}
        </div>
      )}
    </li>
  );
}

// =========================================================
// InterruptionRow
// =========================================================

export function InterruptionRow({
  int,
  intCategories,
  showViewer,
}: {
  int: InterruptionRecord;
  intCategories: CategoryItem[];
  showViewer: (state: ViewerState) => void;
}) {
  const typeLabel = int.type === "work" ? "作業" : "非作業";
  const intMins = Math.floor(int.durationSeconds / 60);
  const intSecs = int.durationSeconds % 60;
  const durStr = intMins > 0 ? `${intMins}分${intSecs > 0 ? intSecs + "秒" : ""}` : `${intSecs}秒`;

  const catObj = int.category ? intCategories.find((c) => c.name === int.category) : undefined;
  const catColor = catObj?.color;

  const firstLine = (int.note || "")
    .split("\n")[0]
    .replace(/&nbsp;/g, " ")
    .trim();

  let startStr = "";
  try {
    const d = new Date(int.startTime);
    startStr =
      String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  } catch {
    /* ignore */
  }

  return (
    <div
      className={s["record-detail-row"]}
      onClick={(e) => {
        e.stopPropagation();
        showViewer({
          markdown: (int.note || "").trim(),
          recordId: int.id,
          recordType: "interruption",
          category: int.category || "",
          sheetType: "InterruptionCategories",
          interruptionType: (int.type as "work" | "nonWork") || null,
          startTime: int.startTime,
          endTime: int.endTime,
        });
      }}
    >
      <CategoryBadge name={int.category} color={catColor} />
      <span className={s["record-desc"]}>{firstLine || "(中断)"}</span>
      <span className={s["record-meta"]}>
        {startStr} {durStr}/{typeLabel}
      </span>
    </div>
  );
}
