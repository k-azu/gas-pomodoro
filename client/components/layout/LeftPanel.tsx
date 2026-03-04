import { useState, useEffect } from "react";
import { useApp } from "../../contexts/AppContext";
import { useDateSelector } from "../../hooks/useDateSelector";
import { TimerCard } from "../timer/TimerCard";
import { DateSelector } from "../timer/DateSelector";
import { StatsCard } from "../timer/StatsCard";
import { HistoryList } from "../timer/HistoryList";
import { CollapsedStrip } from "./CollapsedStrip";
import { STORAGE_KEYS, lsGet, lsSet } from "../../lib/localStorage";
import s from "./LeftPanel.module.css";

export function LeftPanel() {
  const { spreadsheetUrl } = useApp();
  const [collapsed, setCollapsed] = useState(() => !!lsGet(STORAGE_KEYS.LEFT_COLLAPSED));

  const ds = useDateSelector();

  // Load week counts on mount and when weekStartDate changes
  useEffect(() => {
    ds.loadWeekCounts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ds.weekStartDate]);

  const toggleCollapse = () => {
    setCollapsed((prev) => {
      const next = !prev;
      lsSet(STORAGE_KEYS.LEFT_COLLAPSED, next ? "1" : "");
      return next;
    });
  };

  return (
    <div className={`${s["app-left"]}${collapsed ? ` ${s["app-left-collapsed"]}` : ""}`}>
      {collapsed && <CollapsedStrip onExpand={toggleCollapse} />}
      <div className={s["app-content"]}>
        <div className={s.header}>
          <h1>Pomodoro Timer</h1>
          <button
            className={s["left-collapse-btn"]}
            onClick={toggleCollapse}
            title="左パネルを折りたたむ"
          >
            ‹
          </button>
        </div>
        <TimerCard />
        <DateSelector ds={ds} />
        <StatsCard stats={ds.dateStats} />
        <div className={s["history-card"]}>
          <div className={s["history-header"]}>
            <h3>履歴</h3>
            {spreadsheetUrl && (
              <a
                href={spreadsheetUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={s["spreadsheet-link"]}
              >
                スプレッドシートを開く
              </a>
            )}
          </div>
          <HistoryList records={ds.dateRecords} interruptions={ds.dateInterruptions} />
        </div>
      </div>
    </div>
  );
}
