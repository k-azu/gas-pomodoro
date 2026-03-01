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
  // Calculate duration from datetime-local values (YYYY-MM-DDTHH:MM)
  let durationText = "";
  if (startTime && endTime) {
    const ms = new Date(endTime).getTime() - new Date(startTime).getTime();
    if (!isNaN(ms) && ms >= 0) {
      const mins = Math.round(ms / 60000);
      durationText = `${mins}分`;
    }
  }

  return (
    <div className={s["time-input-group"]}>
      <input
        type="datetime-local"
        className={s["time-input"]}
        value={startTime}
        max={endTime || undefined}
        onChange={(e) => {
          const v = e.target.value;
          if (v && endTime && new Date(v) > new Date(endTime)) return;
          onStartChange(v);
        }}
      />
      <span className={s["time-separator"]}>→</span>
      <input
        type="datetime-local"
        className={s["time-input"]}
        value={endTime}
        min={startTime || undefined}
        onChange={(e) => {
          const v = e.target.value;
          if (v && startTime && new Date(v) < new Date(startTime)) return;
          onEndChange(v);
        }}
      />
      {durationText && <span className={s["time-duration"]}>{durationText}</span>}
    </div>
  );
}
