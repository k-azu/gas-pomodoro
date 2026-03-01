import type { PomodoroRecord, InterruptionRecord, CategoryItem } from "../../types";
import { useApp } from "../../contexts/AppContext";
import { useNavigation } from "../../contexts/NavigationContext";
import type { ViewerState } from "../../contexts/NavigationContext";
import s from "./HistoryList.module.css";

export function HistoryList({
  records,
  interruptions,
}: {
  records: PomodoroRecord[];
  interruptions: InterruptionRecord[];
}) {
  const { timer } = useApp();
  const { showViewer } = useNavigation();

  const categories = timer.state.categories;
  const intCategories = timer.state.interruptionCategories;

  const colorMap: Record<string, string> = {};
  categories.forEach((c) => {
    colorMap[c.name] = c.color;
  });

  // Group interruptions by pomodoroId
  const intMap: Record<string, InterruptionRecord[]> = {};
  interruptions.forEach((i) => {
    if (!intMap[i.pomodoroId]) intMap[i.pomodoroId] = [];
    intMap[i.pomodoroId].push(i);
  });

  const workRecords = records.filter((r) => r.type === "work");

  if (workRecords.length === 0) {
    return (
      <div className={s["history-list"]}>
        <div className={s["history-empty"]}>まだ記録がありません</div>
      </div>
    );
  }

  return (
    <ul className={s["history-list"]}>
      {workRecords.map((r) => (
        <HistoryItem
          key={r.id}
          record={r}
          interruptions={intMap[r.id] || []}
          colorMap={colorMap}
          intCategories={intCategories}
          showViewer={showViewer}
        />
      ))}
    </ul>
  );
}

function HistoryItem({
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
  const firstLine = (r.description || "").split("\n")[0].trim();
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
    <li className={s["history-item"]}>
      <div
        className={s["history-item-row"]}
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
            taskId: r.taskId || "",
          })
        }
      >
        <CategoryBadge name={r.category} color={catColor} />
        <span className={s["history-desc"]}>{firstLine || "(無題)"}</span>
        <span className={s["history-meta"]}>{meta}</span>
      </div>
      {interruptions.length > 0 && (
        <div className={s["history-detail"]}>
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

function InterruptionRow({
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

  const firstLine = (int.note || "").split("\n")[0].trim();

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
      className={s["history-detail-row"]}
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
      <span className={s["history-desc"]}>{firstLine || "(中断)"}</span>
      <span className={s["history-meta"]}>
        {startStr} {durStr}/{typeLabel}
      </span>
    </div>
  );
}

function CategoryBadge({ name, color }: { name?: string; color?: string }) {
  if (!name) return <span className={s["history-badge"]} />;

  const style: React.CSSProperties = {};
  if (color) {
    style.background = color + "22";
    style.color = color;
    style.borderColor = color + "44";
  }

  return (
    <span className={s["history-badge"]} style={style}>
      <span
        className={s["history-badge-dot"]}
        style={{ background: color || "var(--text-secondary)" }}
      />
      {name}
    </span>
  );
}
