/**
 * Sidebar — High-level sidebar for flat item lists (memos).
 * Wraps SidebarShell and adds long-press-drag reorder, context menu support.
 */
import type { ReactNode } from "react";
import { SidebarShell, SidebarAddButton, SidebarItem, sidebarStyles as sh } from "./SidebarShell";
import { useLongPressDrag } from "../../hooks/useLongPressDrag";

// Re-export shared pieces so existing consumers keep working
export { InlineRename, SidebarExpandButton } from "./SidebarShell";

export interface SidebarProps<T extends { id: string; name: string }> {
  items: T[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onAdd: () => void;
  renderItem: (item: T) => ReactNode;
  onReorder?: (newOrderIds: string[]) => void;
  onContextMenu?: (e: React.MouseEvent, item: T) => void;
  collapsed: boolean;
  onToggle: () => void;
  width?: number;
  onWidthChange?: (width: number) => void;
  onWidthChangeEnd?: (width: number) => void;
  addLabel?: string;
  addButtonAriaLabel?: string;
  addButtonTitle?: string;
  emptyLabel?: string;
  /** Additional filter (e.g. tag filter) that hides items */
  extraFilter?: (item: T) => boolean;
  /** Slot rendered between header and list (e.g. tag filter button) */
  filterSlot?: ReactNode;
  disabled?: boolean;
}

export function Sidebar<T extends { id: string; name: string }>({
  items,
  activeId,
  onSelect,
  onAdd,
  renderItem,
  onReorder,
  onContextMenu,
  collapsed,
  onToggle,
  width,
  onWidthChange,
  onWidthChangeEnd,
  addLabel = "+",
  addButtonAriaLabel,
  addButtonTitle,
  emptyLabel = "アイテムがありません",
  extraFilter,
  filterSlot,
  disabled = false,
}: SidebarProps<T>) {
  const hasFilter = extraFilter != null;
  const canReorder = !!onReorder && !disabled && !hasFilter && items.length > 1;

  const visibleItems = extraFilter ? items.filter(extraFilter) : items;

  const drag = useLongPressDrag(
    (_dragId, newOrder) => {
      onReorder?.(newOrder);
    },
    { enabled: canReorder },
  );

  const headerSlot = (
    <SidebarAddButton
      onClick={onAdd}
      disabled={disabled}
      ariaLabel={addButtonAriaLabel}
      title={addButtonTitle}
    >
      {addLabel}
    </SidebarAddButton>
  );

  // Build display list: skip dragged item, insert placeholder
  const display: Array<{ type: "item"; item: T } | { type: "placeholder" }> = [];
  let visIdx = 0;
  for (const item of visibleItems) {
    if (item.id === drag.draggingId) continue;
    if (drag.draggingId && visIdx === drag.placeholderIdx) {
      display.push({ type: "placeholder" });
    }
    display.push({ type: "item", item });
    visIdx++;
  }
  if (drag.draggingId && visIdx === drag.placeholderIdx) {
    display.push({ type: "placeholder" });
  }

  return (
    <SidebarShell
      collapsed={collapsed}
      onToggle={onToggle}
      width={width}
      onWidthChange={onWidthChange}
      onWidthChangeEnd={onWidthChangeEnd}
      headerSlot={headerSlot}
      filterSlot={filterSlot}
      isEmpty={visibleItems.length === 0}
      emptyMessage={emptyLabel}
    >
      {display.map((entry) => {
        if (entry.type === "placeholder") {
          return (
            <div
              key="__drag-placeholder__"
              className={sh["drag-placeholder"]}
              style={{ height: drag.placeholderHeight }}
            />
          );
        }
        const item = entry.item;
        const handlers = drag.bind(item.id);
        return (
          <SidebarItem
            key={item.id}
            active={item.id === activeId}
            dataId={item.id}
            onPointerDown={handlers.onPointerDown}
            onPointerMove={handlers.onPointerMove}
            onPointerUp={handlers.onPointerUp}
            onPointerCancel={handlers.onPointerCancel}
            onClick={() => {
              if (disabled) return;
              if (drag.didActivate.current) {
                drag.didActivate.current = false;
                return;
              }
              onSelect(item.id);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              if (disabled) return;
              onContextMenu?.(e, item);
            }}
          >
            {renderItem(item)}
          </SidebarItem>
        );
      })}
    </SidebarShell>
  );
}
