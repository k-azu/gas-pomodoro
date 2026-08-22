/**
 * SidebarShell — Shared sidebar container with collapse/expand, header, and scroll area.
 * Used by both MemoTab (via Sidebar wrapper) and TaskTab directly.
 */
import { useRef, useState, useEffect, useCallback, type ReactNode } from "react";
import {
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  clampSidebarWidth,
} from "../../hooks/useSidebarWidth";
import { GripIcon } from "./Icons";
import s from "./SidebarShell.module.css";

export interface SidebarShellProps {
  collapsed: boolean;
  onToggle: () => void;
  headerSlot?: ReactNode;
  filterSlot?: ReactNode;
  emptyMessage?: string;
  isEmpty?: boolean;
  width?: number;
  onWidthChange?: (width: number) => void;
  onWidthChangeEnd?: (width: number) => void;
  children: ReactNode;
}

export function SidebarShell({
  collapsed,
  onToggle,
  headerSlot,
  filterSlot,
  emptyMessage = "アイテムがありません",
  isEmpty = false,
  width,
  onWidthChange,
  onWidthChangeEnd,
  children,
}: SidebarShellProps) {
  const sidebarRef = useRef<HTMLDivElement>(null);
  const resizeRef = useRef<{
    pointerId: number;
    startX: number;
    startWidth: number;
    lastWidth: number;
  } | null>(null);
  const bodyStyleRef = useRef<{ cursor: string; userSelect: string } | null>(null);
  const [resizing, setResizing] = useState(false);
  const style =
    width != null ? ({ "--sidebar-width": `${width}px` } as React.CSSProperties) : undefined;

  const finishResize = useCallback(
    (pointerId?: number) => {
      const resize = resizeRef.current;
      if (!resize || (pointerId != null && resize.pointerId !== pointerId)) return;

      resizeRef.current = null;
      setResizing(false);
      if (bodyStyleRef.current) {
        document.body.style.cursor = bodyStyleRef.current.cursor;
        document.body.style.userSelect = bodyStyleRef.current.userSelect;
        bodyStyleRef.current = null;
      }
      onWidthChangeEnd?.(resize.lastWidth);
    },
    [onWidthChangeEnd],
  );

  useEffect(() => () => finishResize(), [finishResize]);

  const handleResizePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 || !onWidthChange || resizeRef.current) return;

      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      const startWidth = sidebarRef.current?.getBoundingClientRect().width ?? width ?? 0;
      resizeRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startWidth,
        lastWidth: startWidth,
      };
      bodyStyleRef.current = {
        cursor: document.body.style.cursor,
        userSelect: document.body.style.userSelect,
      };
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      setResizing(true);
    },
    [onWidthChange, width],
  );

  const handleResizePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const resize = resizeRef.current;
      if (!resize || resize.pointerId !== event.pointerId || !onWidthChange) return;

      const nextWidth = clampSidebarWidth(resize.startWidth + event.clientX - resize.startX);
      resize.lastWidth = nextWidth;
      onWidthChange(nextWidth);
    },
    [onWidthChange],
  );

  const handleResizeKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (!onWidthChange) return;

      const currentWidth = width ?? sidebarRef.current?.getBoundingClientRect().width ?? 0;
      const step = event.shiftKey ? 40 : 10;
      let nextWidth: number | null = null;

      if (event.key === "ArrowLeft") nextWidth = currentWidth - step;
      if (event.key === "ArrowRight") nextWidth = currentWidth + step;
      if (event.key === "Home") nextWidth = MIN_SIDEBAR_WIDTH;
      if (event.key === "End") nextWidth = MAX_SIDEBAR_WIDTH;
      if (nextWidth == null) return;

      event.preventDefault();
      const clampedWidth = clampSidebarWidth(nextWidth);
      onWidthChange(clampedWidth);
      onWidthChangeEnd?.(clampedWidth);
    },
    [onWidthChange, onWidthChangeEnd, width],
  );

  if (collapsed) {
    return <div className={`${s.sidebar} ${s.collapsed}`} style={style} />;
  }

  return (
    <div
      ref={sidebarRef}
      className={`${s.sidebar}${resizing ? ` ${s.resizing}` : ""}`}
      style={style}
    >
      <div className={s["sidebar-header"]}>
        <button className={s["sidebar-toggle"]} onClick={onToggle} title="サイドバーを閉じる">
          ‹
        </button>
        {headerSlot}
      </div>
      {filterSlot}
      <div className={s["sidebar-list"]}>
        {isEmpty ? <div className={s["sidebar-empty"]}>{emptyMessage}</div> : children}
      </div>
      {onWidthChange && (
        <div
          className={s["sidebar-resizer"]}
          role="separator"
          aria-label="サイドバーの幅を変更"
          aria-orientation="vertical"
          aria-valuemin={MIN_SIDEBAR_WIDTH}
          aria-valuemax={MAX_SIDEBAR_WIDTH}
          aria-valuenow={Math.round(width ?? MIN_SIDEBAR_WIDTH)}
          tabIndex={0}
          onPointerDown={handleResizePointerDown}
          onPointerMove={handleResizePointerMove}
          onPointerUp={(event) => finishResize(event.pointerId)}
          onPointerCancel={(event) => finishResize(event.pointerId)}
          onLostPointerCapture={(event) => finishResize(event.pointerId)}
          onKeyDown={handleResizeKeyDown}
        />
      )}
    </div>
  );
}

/** Button to re-expand the collapsed sidebar, placed in the content area header */
export function SidebarExpandButton({ onClick }: { onClick: () => void }) {
  return (
    <button className={s["sidebar-expand-btn"]} onClick={onClick} title="サイドバーを開く">
      ›
    </button>
  );
}

/** Shared "+" add button for sidebar headers */
export function SidebarAddButton({
  onClick,
  children = "+",
  className,
  disabled = false,
  ariaLabel,
  title,
}: {
  onClick: () => void;
  children?: ReactNode;
  className?: string;
  disabled?: boolean;
  ariaLabel?: string;
  title?: string;
}) {
  return (
    <button
      className={`${s["sidebar-add-btn"]}${className ? ` ${className}` : ""}`}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      title={title}
    >
      {children}
    </button>
  );
}

/** Flat list item for sidebar (used by Sidebar.tsx for memos) */
export function SidebarItem({
  active,
  draggable,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onClick,
  onContextMenu,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  dragHandle,
  className,
  dataId,
  children,
}: {
  active?: boolean;
  draggable?: boolean;
  onDragStart?: React.DragEventHandler;
  onDragOver?: React.DragEventHandler;
  onDrop?: React.DragEventHandler;
  onDragEnd?: React.DragEventHandler;
  onClick?: () => void;
  onContextMenu?: React.MouseEventHandler;
  onPointerDown?: React.PointerEventHandler;
  onPointerMove?: React.PointerEventHandler;
  onPointerUp?: React.PointerEventHandler;
  onPointerCancel?: React.PointerEventHandler;
  dragHandle?: boolean;
  className?: string;
  dataId?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={`${s["sidebar-item"]}${active ? ` ${s.active}` : ""}${className ? ` ${className}` : ""}`}
      data-id={dataId}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      {dragHandle && (
        <span className={s["sidebar-drag-handle"]}>
          <GripIcon />
        </span>
      )}
      {children}
    </div>
  );
}

/** Inline rename helper — renders an input that commits on blur/Enter */
export function InlineRename({
  initialValue,
  onCommit,
  onCancel,
}: {
  initialValue: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);

  const finish = useCallback(() => {
    const v = ref.current?.value.trim() || initialValue;
    onCommit(v);
  }, [initialValue, onCommit]);

  return (
    <input
      ref={(el) => {
        if (el) {
          ref.current = el;
          el.focus();
          el.select();
        }
      }}
      type="text"
      className={s["sidebar-rename-input"]}
      defaultValue={initialValue}
      onBlur={finish}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          (e.target as HTMLInputElement).blur();
        }
        if (e.key === "Escape") {
          onCancel();
        }
      }}
    />
  );
}

/** Re-export styles for external use (e.g. search input styling) */
export { s as sidebarStyles };
