import { useRef } from "react";
import { formatLabel } from "../../hooks/useDateSelector";
import { CalendarIcon } from "../shared/Icons";
import { WeekStrip } from "./WeekStrip";
import type { UseDateSelectorReturn } from "../../hooks/useDateSelector";
import s from "./DateSelector.module.css";

export function DateSelector({ ds }: { ds: UseDateSelectorReturn }) {
  const calendarRef = useRef<HTMLInputElement>(null);

  const today = new Date();
  const maxDate =
    today.getFullYear() +
    "-" +
    String(today.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(today.getDate()).padStart(2, "0");

  const openCalendar = () => {
    calendarRef.current?.showPicker();
  };

  return (
    <div className={s['date-selector']}>
      <div className={s['date-header']}>
        <span className={s['date-header-label']}>
          {ds.isToday ? `今日 - ${formatLabel(ds.selectedDate)}` : formatLabel(ds.selectedDate)}
        </span>
        <div className={s['date-header-actions']}>
          {!ds.isToday && (
            <button className={s['date-today-btn']} onClick={ds.goToToday}>
              今日
            </button>
          )}
          <div className={s['date-calendar-wrapper']}>
            <button
              className={s['date-calendar-btn']}
              onClick={openCalendar}
              title="カレンダーから日付を選択"
            >
              <CalendarIcon />
            </button>
            <input
              ref={calendarRef}
              type="date"
              className={s['date-calendar-input']}
              max={maxDate}
              value={ds.selectedDate}
              onChange={(e) => {
                if (e.target.value) ds.selectDate(e.target.value);
              }}
            />
          </div>
        </div>
      </div>
      <div className={s['week-strip-container']}>
        <button className={s['week-nav-btn']} onClick={ds.prevWeek}>
          ‹
        </button>
        <WeekStrip
          weekStartDate={ds.weekStartDate}
          selectedDate={ds.selectedDate}
          weekRecordCounts={ds.weekRecordCounts}
          onSelect={ds.selectDate}
        />
        <button className={s['week-nav-btn']} onClick={ds.nextWeek}>
          ›
        </button>
      </div>
    </div>
  );
}
