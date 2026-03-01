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
}

export function ContentHeaderName({
  name,
  onRename,
  renaming,
  onRenameEnd,
  suffix,
}: ContentHeaderNameProps) {
  const [isEditing, setIsEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

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
    setIsEditing(false);
    onRenameEnd?.();
  }, [onRenameEnd]);

  if (isEditing) {
    return (
      <input
        ref={inputRef}
        className={s["header-rename-input"]}
        defaultValue={name}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") cancel();
        }}
      />
    );
  }

  return (
    <span className={s["header-name"]} onClick={() => onRename && setIsEditing(true)}>
      {name}
      {suffix}
    </span>
  );
}
