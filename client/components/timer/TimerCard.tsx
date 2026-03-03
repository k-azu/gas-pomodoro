import { useState, useRef, useEffect, useCallback } from "react";
import { useApp } from "../../contexts/AppContext";
import { ChevronDownIcon } from "../shared/Icons";
import s from "./TimerCard.module.css";

export function TimerCard() {
  const { timer } = useApp();
  const { state, displayTime, phaseLabel, isOvertime, workProgressText, dataPhase } = timer;
  const phase = state.phase;
  const isIdle = phase === "idle";

  return (
    <div
      className={`${s["timer-card"]}${isOvertime ? ` ${s.overtime}` : ""}`}
      data-phase={dataPhase}
    >
      <div className={s["phase-label"]}>{phaseLabel}</div>
      {phase === "interrupted" && workProgressText && (
        <div className={s["work-progress"]}>{workProgressText}</div>
      )}
      {isIdle ? <PatternDisplay /> : <div className={s["timer-display"]}>{displayTime}</div>}
      {state.interruptions.length > 0 && phase !== "idle" && (
        <div className={s["interruption-badge"]}>{state.interruptions.length}件の中断</div>
      )}
      <PomodoroDots />
      <TimerControls />
    </div>
  );
}

function PatternDisplay() {
  const { timer } = useApp();
  const { state, onPatternChange, setCustomConfig } = timer;
  const { config, configPatterns } = state;
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [editingField, setEditingField] = useState<"work" | "short" | "long" | null>(null);
  const [editValue, setEditValue] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!dropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [dropdownOpen]);

  // Focus input when editing starts
  useEffect(() => {
    if (editingField && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingField]);

  const startEdit = (field: "work" | "short" | "long") => {
    const valueMap = {
      work: config.workMinutes,
      short: config.shortBreakMinutes,
      long: config.longBreakMinutes,
    };
    setEditingField(field);
    setEditValue(String(valueMap[field]));
  };

  const commitEdit = useCallback(() => {
    if (!editingField) return;
    const num = parseInt(editValue, 10);
    if (isNaN(num) || num <= 0) {
      setEditingField(null);
      return;
    }
    const fieldMap = {
      work: "workMinutes",
      short: "shortBreakMinutes",
      long: "longBreakMinutes",
    } as const;
    setCustomConfig({ [fieldMap[editingField]]: num });
    setEditingField(null);
  }, [editingField, editValue, setCustomConfig]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") commitEdit();
    if (e.key === "Escape") setEditingField(null);
  };

  const renderValue = (field: "work" | "short" | "long", value: number) => {
    const isPrimary = field === "work";
    const isEditing = editingField === field;
    const valueCls = `${s["pattern-value"]}${isPrimary ? ` ${s["pattern-value-primary"]}` : ""}`;
    return (
      <span className={s["pattern-value-slot"]}>
        {/* Hidden sizer keeps width/height stable */}
        <span className={`${valueCls} ${s["pattern-value-sizer"]}`} aria-hidden>
          {isEditing ? editValue || value : value}
        </span>
        {isEditing ? (
          <input
            ref={inputRef}
            type="number"
            className={`${s["pattern-input"]}${isPrimary ? ` ${s["pattern-input-primary"]}` : ""}`}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={handleKeyDown}
            min={1}
            max={999}
          />
        ) : (
          <button className={valueCls} onClick={() => startEdit(field)}>
            {value}
          </button>
        )}
      </span>
    );
  };

  return (
    <div className={s["pattern-display-wrapper"]}>
      <div className={s["pattern-display"]}>
        {renderValue("work", config.workMinutes)}
        <span className={s["pattern-separator"]}>/</span>
        {renderValue("short", config.shortBreakMinutes)}
        <span className={s["pattern-separator"]}>/</span>
        {renderValue("long", config.longBreakMinutes)}
      </div>
      <div className={s["pattern-dropdown-anchor"]} ref={dropdownRef}>
        <button
          className={s["pattern-dropdown-btn"]}
          onClick={() => setDropdownOpen((v) => !v)}
          aria-label="パターン切替"
        >
          <ChevronDownIcon size={16} />
        </button>
        {dropdownOpen && (
          <div className={s["pattern-dropdown"]}>
            {configPatterns.map((p) => {
              const isSelected = p.patternName === config.patternName;
              return (
                <button
                  key={p.patternName}
                  className={`${s["pattern-dropdown-item"]}${isSelected ? ` ${s.active}` : ""}`}
                  onClick={() => {
                    onPatternChange(p.patternName);
                    setDropdownOpen(false);
                  }}
                >
                  <span className={s["pattern-dropdown-name"]}>{p.patternName}</span>
                  <span className={s["pattern-dropdown-values"]}>
                    {p.workMinutes}/{p.shortBreakMinutes}/{p.longBreakMinutes}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function PomodoroDots() {
  const { timer } = useApp();
  const { state, setCustomConfig } = timer;
  const limit = state.config.pomodorosBeforeLongBreak;
  const isIdle = state.phase === "idle";
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const startEdit = () => {
    if (!isIdle) return;
    setEditValue(String(limit));
    setEditing(true);
  };

  const commitEdit = useCallback(() => {
    if (!editing) return;
    const num = parseInt(editValue, 10);
    if (!isNaN(num) && num >= 1 && num <= 10) {
      setCustomConfig({ pomodorosBeforeLongBreak: num });
    }
    setEditing(false);
  }, [editing, editValue, setCustomConfig]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") commitEdit();
    if (e.key === "Escape") setEditing(false);
  };

  return (
    <div className={s["pomodoro-dots"]}>
      {Array.from({ length: limit }, (_, i) => {
        const idx = i + 1;
        let cls = "pomodoro-dot";
        if (idx < state.pomodoroSetIndex) cls += " completed";
        else if (
          idx === state.pomodoroSetIndex &&
          (state.phase === "work" || state.phase === "interrupted")
        )
          cls += " current";
        return <div key={i} className={cls} />;
      })}
      {isIdle && (
        <span className={s["pomodoro-count-slot"]}>
          <span className={s["pomodoro-count-sizer"]} aria-hidden>
            ×{editing ? editValue || limit : limit}
          </span>
          {editing ? (
            <input
              ref={inputRef}
              type="number"
              className={s["pomodoro-count-input"]}
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={commitEdit}
              onKeyDown={handleKeyDown}
              min={1}
              max={10}
            />
          ) : (
            <button className={s["pomodoro-count-btn"]} onClick={startEdit}>
              ×{limit}
            </button>
          )}
        </span>
      )}
    </div>
  );
}

function TimerControls() {
  const { timer } = useApp();
  const { state } = timer;
  const phase = state.phase;

  return (
    <div className={s["timer-controls"]}>
      {phase === "idle" && (
        <button className="btn btn-primary" onClick={timer.startWork}>
          開始
        </button>
      )}
      {phase === "work" && (
        <button className="btn btn-warning" onClick={timer.startInterruption}>
          中断
        </button>
      )}
      {(phase === "shortBreak" || phase === "longBreak" || phase === "breakDone") && (
        <>
          <button className="btn btn-primary" onClick={timer.continueWork}>
            次の作業
          </button>
          <button className="btn btn-secondary" onClick={timer.endSession}>
            終了
          </button>
        </>
      )}
    </div>
  );
}
