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
}: {
  records: PomodoroRecord[];
  interruptions: InterruptionRecord[];
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
