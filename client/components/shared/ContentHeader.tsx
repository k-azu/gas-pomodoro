/**
 * ContentHeader — Unified header bar for all right-panel tabs
 * Replaces PanelToolbar (for primary headers) and task-detail-header.
 */
import { useState, useRef, useEffect, useCallback } from "react";
import type { ReactNode } from "react";
import { SidebarExpandButton } from "./Sidebar";
import s from "./ContentHeader.module.css";

interface ContentHeaderProps {
  sidebarCollapsed?: boolean;
  onExpandSidebar?: () => void;
  secondaryRow?: ReactNode;
  emptyMessage?: string;
  children?: ReactNode;
}

export function ContentHeader({
  sidebarCollapsed,
  onExpandSidebar,
  secondaryRow,
  emptyMessage,
  children,
}: ContentHeaderProps) {
  // Empty state: show expand button (when collapsed) + centered message
  if (!children && emptyMessage) {
    return (
      <>
        {sidebarCollapsed && onExpandSidebar && (
          <div className={s["empty-header"]}>
            <SidebarExpandButton onClick={onExpandSidebar} />
          </div>
        )}
        <div className={s["empty-state"]}>
          <p>{emptyMessage}</p>
        </div>
      </>
    );
  }

  return (
    <>
      <div className={s["header"]}>
        {sidebarCollapsed && onExpandSidebar && <SidebarExpandButton onClick={onExpandSidebar} />}
        {children}
      </div>
      {secondaryRow && <div className={s["header-secondary"]}>{secondaryRow}</div>}
    </>
  );
}

interface ContentHeaderNameProps {
  name: string;
  onRename?: (name: string) => void;
  renaming?: boolean;
  onRenameEnd?: () => void;
  suffix?: ReactNode;
  /** Shrink input to text width so suffix sits right after the name */
  autoSize?: boolean;
}

export function ContentHeaderName({
  name,
  onRename,
  renaming,
  onRenameEnd,
  suffix,
  autoSize,
}: ContentHeaderNameProps) {
  const [isEditing, setIsEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const sizerRef = useRef<HTMLSpanElement>(null);
  const [inputWidth, setInputWidth] = useState<number | undefined>(undefined);

  // Measure text width for auto-sizing
  const measureWidth = useCallback(() => {
    if (!autoSize || !sizerRef.current || !inputRef.current) return;
    sizerRef.current.textContent = inputRef.current.value || name;
    setInputWidth(sizerRef.current.offsetWidth + 2); // +2 for cursor
  }, [autoSize, name]);

  // Sync input value when name prop changes (e.g. document switch)
  useEffect(() => {
    if (inputRef.current && !isEditing) {
      inputRef.current.value = name;
    }
    measureWidth();
  }, [name, isEditing, measureWidth]);

  // External trigger (e.g. context menu "名前変更")
  useEffect(() => {
    if (renaming) {
      setIsEditing(true);
    }
  }, [renaming]);

  // Focus input when editing starts
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const commit = useCallback(() => {
    const value = inputRef.current?.value.trim();
    if (value && value !== name && onRename) {
      onRename(value);
    }
    setIsEditing(false);
    onRenameEnd?.();
  }, [name, onRename, onRenameEnd]);

  const cancel = useCallback(() => {
    if (inputRef.current) inputRef.current.value = name;
    setIsEditing(false);
    onRenameEnd?.();
  }, [name, onRenameEnd]);

  const wrapperClass =
    autoSize && !isEditing
      ? `${s["header-name-wrapper"]} ${s["header-name-wrapper-autosize"]}`
      : s["header-name-wrapper"];

  // Single <input> always rendered — editing state changes only CSS class
  return (
    <span className={wrapperClass}>
      {autoSize && <span ref={sizerRef} className={s["header-name-sizer"]} aria-hidden />}
      <input
        ref={inputRef}
        className={`${s["header-name-input"]} ${isEditing ? s["editing"] : ""}`}
        defaultValue={name}
        readOnly={!isEditing}
        style={autoSize && !isEditing && inputWidth ? { width: inputWidth } : undefined}
        onClick={() => {
          if (!isEditing && onRename) setIsEditing(true);
        }}
        onBlur={() => {
          if (isEditing) commit();
        }}
        onKeyDown={(e) => {
          if (!isEditing) return;
          if (e.key === "Enter") commit();
          if (e.key === "Escape") cancel();
        }}
      />
      {!isEditing && suffix}
    </span>
  );
}
