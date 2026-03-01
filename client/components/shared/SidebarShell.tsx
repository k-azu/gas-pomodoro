/**
 * SidebarShell — Shared sidebar container with collapse/expand, header, and scroll area.
 * Used by both MemoTab (via Sidebar wrapper) and TaskTab directly.
 */
import { useRef, useCallback, type ReactNode } from "react";
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
  children,
}: SidebarShellProps) {
  const style = width ? ({ "--sidebar-width": `${width}px` } as React.CSSProperties) : undefined;

  if (collapsed) {
    return <div className={`${s.sidebar} ${s.collapsed}`} style={style} />;
  }

  return (
    <div className={s.sidebar} style={style}>
      <div className={s["sidebar-header"]}>
        <button className={s["sidebar-toggle"]} onClick={onToggle} title="サイドバーを閉じる">
          ‹
        </button>
        {headerSlot}
      </div>
      {filterSlot}
      <div className={s["sidebar-list"]}>
        {isEmpty ? (
          <div className={s["sidebar-empty"]}>{emptyMessage}</div>
        ) : (
          children
        )}
      </div>
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
}: {
  onClick: () => void;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <button
      className={`${s["sidebar-add-btn"]}${className ? ` ${className}` : ""}`}
      onClick={onClick}
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
