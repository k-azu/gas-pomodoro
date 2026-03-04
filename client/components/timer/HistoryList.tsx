import type { PomodoroRecord, InterruptionRecord } from "../../types";
import { useCallback } from "react";
import { useApp } from "../../contexts/AppContext";
import { useNavigation } from "../../contexts/NavigationContext";
import type { ViewerState } from "../../contexts/NavigationContext";
import { RecordRow } from "../shared/RecordRow";
import s from "./HistoryList.module.css";

export function HistoryList({
  records,
  interruptions,
  isLoading,
}: {
  records: PomodoroRecord[];
  interruptions: InterruptionRecord[];
  isLoading?: boolean;
}) {
  const { timer } = useApp();
  const { showViewer, isViewerSaving } = useNavigation();

  const guardedShowViewer = useCallback(
    (state: ViewerState) => {
      if (isViewerSaving) return;
      showViewer(state);
    },
    [showViewer, isViewerSaving],
  );

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

  if (isLoading && workRecords.length === 0) {
    return (
      <div className={s["history-list"]}>
        <div className={s["history-loading"]}>
          <span className={s["spinner"]} />
        </div>
      </div>
    );
  }

  if (workRecords.length === 0) {
    return (
      <div className={s["history-list"]}>
        <div className={s["history-empty"]}>まだ記録がありません</div>
      </div>
    );
  }

  return (
    <ul className={s["history-list"]}>
      {isLoading && (
        <div className={s["history-loading-overlay"]}>
          <span className={s["spinner"]} />
        </div>
      )}
      {workRecords.map((r) => (
        <RecordRow
          key={r.id}
          record={r}
          interruptions={intMap[r.id] || []}
          colorMap={colorMap}
          intCategories={intCategories}
          showViewer={guardedShowViewer}
        />
      ))}
    </ul>
  );
}
