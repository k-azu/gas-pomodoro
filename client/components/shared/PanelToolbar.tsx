/**
 * PanelToolbar — Shared toolbar component used across panels
 * (Record, Interruption, Viewer, Memo, Task)
 */
import type { ReactNode } from "react";
import s from "./PanelToolbar.module.css";

export function PanelToolbar({
  children,
  wrap = false,
  bg = false,
}: {
  children: ReactNode;
  wrap?: boolean;
  bg?: boolean;
}) {
  return (
    <div
      className={`${s["panel-toolbar"]}${wrap ? ` ${s["panel-toolbar-wrap"]}` : ""}${bg ? ` ${s["panel-toolbar-bg"]}` : ""}`}
    >
      {children}
    </div>
  );
}

export function ToolbarLabel({ children }: { children: ReactNode }) {
  return <span className={s["panel-toolbar-label"]}>{children}</span>;
}

export function ToolbarButton({
  onClick,
  disabled,
  variant,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  variant?: "primary" | "secondary" | "warning" | "danger";
  children: ReactNode;
}) {
  return (
    <button
      className={`btn${variant ? ` btn-${variant}` : " btn-secondary"} ${s["panel-toolbar-btn"]}${variant === "primary" ? ` ${s["panel-toolbar-btn-primary"]}` : ""}`}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

export function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button className={s["panel-toolbar-back"]} onClick={onClick}>
      ←
    </button>
  );
}

export function TypeToggle({
  checked,
  onChange,
  label = "作業に含める",
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
}) {
  return (
    <label className={s["type-toggle"]}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

/** True when both datetime-local values are valid and the end precedes the start. */
export function isTimeRangeReversed(startTime: string, endTime: string): boolean {
  if (!startTime || !endTime) return false;
  const start = new Date(startTime).getTime();
  const end = new Date(endTime).getTime();
  return !isNaN(start) && !isNaN(end) && end < start;
}

export function TimeInputGroup({
  startTime,
  endTime,
  onStartChange,
  onEndChange,
}: {
  startTime: string;
  endTime: string;
  onStartChange: (v: string) => void;
  onEndChange: (v: string) => void;
}) {
  // Intermediate values (e.g. editing the hour before the minute) may briefly put the end
  // before the start, so accept every value and report the reversed range instead of
  // rejecting input.
  const reversed = isTimeRangeReversed(startTime, endTime);
  let durationText = "";
  if (startTime && endTime && !reversed) {
    const ms = new Date(endTime).getTime() - new Date(startTime).getTime();
    if (!isNaN(ms)) durationText = `${Math.round(ms / 60000)}分`;
  }

  return (
    <div className={s["time-input-group"]}>
      <input
        type="datetime-local"
        className={s["time-input"]}
        value={startTime}
        onChange={(e) => onStartChange(e.target.value)}
      />
      <span className={s["time-separator"]}>→</span>
      <input
        type="datetime-local"
        className={`${s["time-input"]}${reversed ? ` ${s["time-input-invalid"]}` : ""}`}
        value={endTime}
        onChange={(e) => onEndChange(e.target.value)}
        aria-invalid={reversed || undefined}
      />
      {reversed ? (
        <span className={s["time-error"]} role="alert">
          終了が開始より前です
        </span>
      ) : (
        durationText && <span className={s["time-duration"]}>{durationText}</span>
      )}
    </div>
  );
}
