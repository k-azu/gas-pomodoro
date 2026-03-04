import type { TodayStats } from "../../types";
import s from "./StatsCard.module.css";

function formatDuration(totalSeconds: number): string {
  const totalMins = Math.floor(totalSeconds / 60);
  const hours = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  if (hours > 0) return `${hours}時間${mins}分`;
  return `${mins}分`;
}

export function StatsCard({ stats, isLoading }: { stats: TodayStats; isLoading?: boolean }) {
  return (
    <div className={s["stats-card"]}>
      {isLoading && (
        <div className={s["stats-loading"]}>
          <span className={s["spinner"]} />
        </div>
      )}
      <h3>集計</h3>
      <div className={s["stats-grid"]}>
        <div className={s["stats-item"]}>
          <div className={s["stats-value"]}>
            {stats.completedPomodoros}
            {stats.abandonedPomodoros > 0 && (
              <span className={s["stats-abandoned"]}> / {stats.abandonedPomodoros}</span>
            )}
          </div>
          <div className={s["stats-label"]}>完了</div>
        </div>
        <div className={s["stats-item"]}>
          <div className={s["stats-value"]}>{formatDuration(stats.totalWorkSeconds)}</div>
          <div className={s["stats-label"]}>作業</div>
        </div>
        <div className={s["stats-item"]}>
          <div className={s["stats-value"]}>{formatDuration(stats.totalBreakSeconds)}</div>
          <div className={s["stats-label"]}>休憩</div>
        </div>
        <div className={s["stats-item"]}>
          <div className={s["stats-value"]}>
            {formatDuration(stats.totalWorkInterruptionSeconds)}
          </div>
          <div className={s["stats-label"]}>中断(作業)</div>
        </div>
        <div className={s["stats-item"]}>
          <div className={s["stats-value"]}>
            {formatDuration(stats.totalNonWorkInterruptionSeconds)}
          </div>
          <div className={s["stats-label"]}>中断(非作業)</div>
        </div>
      </div>
    </div>
  );
}
