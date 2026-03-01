import { addDays } from "../../hooks/useDateSelector";
import s from "./WeekStrip.module.css";

const WEEK_DAYS = ["月", "火", "水", "木", "金", "土", "日"];

function getTodayStr(): string {
  const d = new Date();
  return (
    d.getFullYear() +
    "-" +
    String(d.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(d.getDate()).padStart(2, "0")
  );
}

export function WeekStrip({
  weekStartDate,
  selectedDate,
  weekRecordCounts,
  onSelect,
}: {
  weekStartDate: string;
  selectedDate: string;
  weekRecordCounts: Record<string, number>;
  onSelect: (dateStr: string) => void;
}) {
  const today = getTodayStr();
  const weekEnd = addDays(weekStartDate, 6);
  const inCurrentWeek = selectedDate >= weekStartDate && selectedDate <= weekEnd;

  return (
    <div className={s['week-strip']}>
      {Array.from({ length: 7 }, (_, i) => {
        const dateStr = addDays(weekStartDate, i);
        const d = new Date(dateStr + "T00:00:00");
        const isFuture = dateStr > today;
        const count = weekRecordCounts[dateStr] || 0;

        let cls = s['week-day-btn'];
        if (inCurrentWeek && dateStr === selectedDate) cls += ` ${s.selected}`;
        if (dateStr === today) cls += ` ${s.today}`;
        if (isFuture) cls += ` ${s.future}`;

        return (
          <button
            key={dateStr}
            className={cls}
            disabled={isFuture}
            onClick={() => onSelect(dateStr)}
          >
            <span className={s['week-day-label']}>{WEEK_DAYS[i]}</span>
            <span className={s['week-day-num']}>{d.getDate()}</span>
            <span
              className={
                count > 0 && !isFuture ? s['week-day-indicator'] : s['week-day-indicator-spacer']
              }
            />
          </button>
        );
      })}
    </div>
  );
}
