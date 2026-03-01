import { useApp } from "../../contexts/AppContext";
import s from "./CollapsedStrip.module.css";

export function CollapsedStrip({ onExpand }: { onExpand: () => void }) {
  const { timer } = useApp();
  const { state, displayTime, dataPhase } = timer;
  const limit = state.config.pomodorosBeforeLongBreak;

  return (
    <div className={s['app-left-strip']} data-phase={dataPhase} onClick={onExpand}>
      <div className={s['strip-time']}>{displayTime}</div>
      <div className={s['strip-dots']}>
        {Array.from({ length: limit }, (_, i) => {
          const idx = limit - i; // reversed order
          let cls = "pomodoro-dot";
          if (idx < state.pomodoroSetIndex) cls += " completed";
          else if (
            idx === state.pomodoroSetIndex &&
            (state.phase === "work" || state.phase === "interrupted")
          )
            cls += " current";
          return <div key={i} className={cls} />;
        })}
      </div>
    </div>
  );
}
