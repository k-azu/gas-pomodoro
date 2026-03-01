/**
 * Sidebar — High-level sidebar for flat item lists (memos).
 * Wraps SidebarShell and adds search, long-press-drag reorder, context menu support.
 */
import { useState, type ReactNode } from "react";
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
  searchFilter?: (item: T, query: string) => boolean;
  collapsed: boolean;
  onToggle: () => void;
  addLabel?: string;
  emptyLabel?: string;
  /** Additional filter (e.g. tag filter) that hides items */
  extraFilter?: (item: T) => boolean;
  /** Slot rendered between search and list (e.g. tag filter button) */
  filterSlot?: ReactNode;
}

export function Sidebar<T extends { id: string; name: string }>({
  items,
  activeId,
  onSelect,
  onAdd,
  renderItem,
  onReorder,
  onContextMenu,
  searchFilter,
  collapsed,
  onToggle,
  addLabel = "+",
  emptyLabel = "アイテムがありません",
  extraFilter,
  filterSlot,
}: SidebarProps<T>) {
  const [searchQuery, setSearchQuery] = useState("");

  const q = searchQuery.toLowerCase();
  const hasFilter = !!q || (extraFilter != null);
  const canReorder = !!onReorder && !hasFilter && items.length > 1;

  const visibleItems = items.filter((item) => {
    const matchSearch = !q || (searchFilter ? searchFilter(item, q) : item.name.toLowerCase().includes(q));
    const matchExtra = !extraFilter || extraFilter(item);
    return matchSearch && matchExtra;
  });

  const drag = useLongPressDrag(
    (_dragId, newOrder) => { onReorder?.(newOrder); },
    { enabled: canReorder },
  );

  const headerSlot = (
    <>
      <input
        className={sh["sidebar-search"]}
        type="text"
        placeholder="検索..."
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
      />
      <SidebarAddButton onClick={onAdd}>{addLabel}</SidebarAddButton>
    </>
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
              if (drag.didActivate.current) {
                drag.didActivate.current = false;
                return;
              }
              onSelect(item.id);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
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
