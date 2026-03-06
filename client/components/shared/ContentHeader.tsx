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
  const lastSwRef = useRef(0);
  const editingRef = useRef(false);
  editingRef.current = isEditing;
  const hasSuffix = !!suffix;

  // Auto-size: set width to scrollWidth so suffix sits right after the text.
  // scrollWidth gives exact pixel width of the content regardless of font/language.
  const syncWidth = useCallback(() => {
    const el = inputRef.current;
    if (!el || !hasSuffix || editingRef.current) return;
    // Shrink to 0 so scrollWidth reflects true content width, not container width
    el.style.width = "0";
    const sw = el.scrollWidth;
    if (sw > 0 && sw !== lastSwRef.current) {
      lastSwRef.current = sw;
      // +16 accounts for subpixel rounding differences across browsers (notably Firefox)
      el.style.width = `${sw + 16}px`;
    } else if (sw === lastSwRef.current) {
      el.style.width = `${sw + 16}px`;
    } else {
      el.style.width = "";
    }
  }, [hasSuffix]);

  // Sync input value when name prop changes (e.g. document switch)
  useEffect(() => {
    if (inputRef.current && !isEditing) {
      inputRef.current.value = name;
    }
    lastSwRef.current = 0; // reset cache so syncWidth recalculates
    syncWidth();
  }, [name, isEditing, syncWidth]);

  // Re-measure when becoming visible (e.g. tab switch from display:none)
  useEffect(() => {
    if (!hasSuffix || !inputRef.current) return;
    const ro = new ResizeObserver(() => syncWidth());
    ro.observe(inputRef.current);
    return () => ro.disconnect();
  }, [hasSuffix, syncWidth]);

  // External trigger (e.g. context menu "名前変更")
  useEffect(() => {
    if (renaming) {
      setIsEditing(true);
    }
  }, [renaming]);

  // Focus input when editing starts; clear inline width so CSS width:100% takes effect
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.style.width = "";
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

  return (
    <>
      <input
        ref={inputRef}
        className={`${s["header-name-input"]}${isEditing ? ` ${s["editing"]}` : ""}${suffix && !isEditing ? ` ${s["auto-width"]}` : ""}`}
        defaultValue={name}
        readOnly={!isEditing}
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
    </>
  );
}
