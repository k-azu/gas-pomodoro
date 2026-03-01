/**
 * useLongPressDrag — Long press to drag-reorder with ghost + placeholder.
 *
 * Visual behavior (matches original GAS TaskPanel):
 *  - Long press (250ms) on an item activates drag
 *  - A semi-transparent ghost clone follows the pointer
 *  - A dashed blue placeholder shows where the item will land
 *  - The original item is hidden from the list
 *  - On release, the new order is committed
 *
 * Pointer-event based — works with both touch and mouse.
 */
import { useState, useRef, useCallback, useEffect } from "react";

interface UseLongPressDragOptions {
  delay?: number;
  moveThreshold?: number;
  enabled?: boolean;
  /** Resolve the drag container from the item element.
   *  Default: el.parentElement */
  getContainer?: (itemEl: HTMLElement) => HTMLElement | null;
  /** Get sibling items (excluding dragged) in the container.
   *  Default: children with data-id, excluding draggingId */
  getItems?: (container: HTMLElement, draggingId: string) => HTMLElement[];
}

interface DragSnapshot {
  draggingId: string;
  placeholderIdx: number;
  placeholderHeight: number;
}

export function useLongPressDrag(
  onReorder: (draggingId: string, newOrderIds: string[]) => void,
  options: UseLongPressDragOptions = {},
) {
  const { delay = 250, moveThreshold = 8, enabled = true } = options;

  const [snap, setSnap] = useState<DragSnapshot | null>(null);

  // Stable refs for latest values
  const onReorderRef = useRef(onReorder);
  onReorderRef.current = onReorder;
  const getContainerRef = useRef(options.getContainer);
  getContainerRef.current = options.getContainer;
  const getItemsRef = useRef(options.getItems);
  getItemsRef.current = options.getItems;

  // Internal refs
  const ghostRef = useRef<HTMLElement | null>(null);
  const containerRef = useRef<HTMLElement | null>(null);
  const offsetYRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<{ el: HTMLElement; x: number; y: number } | null>(null);
  const didActivate = useRef(false);
  const draggingIdRef = useRef<string | null>(null);
  const placeholderIdxRef = useRef(0);
  const rafRef = useRef(0);

  // ── helpers ──────────────────────────────────────────────

  const defaultGetItems = useCallback(
    (container: HTMLElement, draggingId: string): HTMLElement[] =>
      Array.from(container.children).filter(
        (el) => (el as HTMLElement).dataset?.id && (el as HTMLElement).dataset.id !== draggingId,
      ) as HTMLElement[],
    [],
  );

  const resolveItems = useCallback(
    (container: HTMLElement, draggingId: string) =>
      (getItemsRef.current ?? defaultGetItems)(container, draggingId),
    [defaultGetItems],
  );

  const clearTimer = useCallback(() => {
    if (timerRef.current != null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const cleanup = useCallback(() => {
    clearTimer();
    cancelAnimationFrame(rafRef.current);
    ghostRef.current?.remove();
    ghostRef.current = null;
    containerRef.current = null;
    pendingRef.current = null;
    draggingIdRef.current = null;
    placeholderIdxRef.current = 0;
    document.body.style.userSelect = "";
    document.body.style.webkitUserSelect = "";
    setSnap(null);
  }, [clearTimer]);

  // ── start drag ───────────────────────────────────────────

  const startDrag = useCallback(
    (itemId: string, info: { el: HTMLElement; x: number; y: number }) => {
      const { el, x, y } = info;
      const getContainer = getContainerRef.current ?? ((e: HTMLElement) => e.parentElement);
      const container = getContainer(el);
      if (!container) return;

      const rect = el.getBoundingClientRect();
      const offsetY = y - rect.top;

      // Ghost — DOM clone appended to body
      const clone = el.cloneNode(true) as HTMLElement;
      clone.style.cssText = [
        `position:fixed`,
        `left:${rect.left}px`,
        `top:${y - offsetY}px`,
        `width:${rect.width}px`,
        `z-index:300`,
        `pointer-events:none`,
        `opacity:0.85`,
        `box-shadow:0 4px 12px rgba(0,0,0,0.15)`,
        `background:var(--surface,#fff)`,
        `border-radius:4px`,
        `transition:none`,
      ].join(";");
      document.body.appendChild(clone);

      // Prevent text selection during drag
      window.getSelection()?.removeAllRanges();
      document.body.style.userSelect = "none";
      document.body.style.webkitUserSelect = "none";

      ghostRef.current = clone;
      containerRef.current = container;
      offsetYRef.current = offsetY;
      draggingIdRef.current = itemId;
      didActivate.current = true;

      // Initial placeholder position
      const items = resolveItems(container, itemId);
      let insertIdx = items.length;
      for (let i = 0; i < items.length; i++) {
        const r = items[i].getBoundingClientRect();
        if (y < r.top + r.height / 2) { insertIdx = i; break; }
      }
      placeholderIdxRef.current = insertIdx;
      setSnap({ draggingId: itemId, placeholderIdx: insertIdx, placeholderHeight: rect.height });
    },
    [resolveItems],
  );

  // ── document-level handlers while dragging ───────────────

  useEffect(() => {
    if (!snap) return;

    const handleMove = (e: PointerEvent) => {
      e.preventDefault();

      // Move ghost
      if (ghostRef.current) {
        ghostRef.current.style.top = `${e.clientY - offsetYRef.current}px`;
      }

      // Update placeholder (rAF-throttled)
      const pointerY = e.clientY;
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        const container = containerRef.current;
        const dragId = draggingIdRef.current;
        if (!container || !dragId) return;

        const items = resolveItems(container, dragId);
        let insertIdx = items.length;
        for (let i = 0; i < items.length; i++) {
          const r = items[i].getBoundingClientRect();
          if (pointerY < r.top + r.height / 2) { insertIdx = i; break; }
        }

        if (insertIdx !== placeholderIdxRef.current) {
          placeholderIdxRef.current = insertIdx;
          setSnap((prev) => (prev ? { ...prev, placeholderIdx: insertIdx } : null));
        }
      });
    };

    const handleUp = (e: PointerEvent) => {
      cancelAnimationFrame(rafRef.current);
      ghostRef.current?.remove();

      const dragId = draggingIdRef.current;
      const container = containerRef.current;
      if (dragId && container) {
        // Recompute final position from pointer at release
        const items = resolveItems(container, dragId);
        let insertIdx = items.length;
        for (let i = 0; i < items.length; i++) {
          const r = items[i].getBoundingClientRect();
          if (e.clientY < r.top + r.height / 2) { insertIdx = i; break; }
        }
        const otherIds = items.map((el) => (el as HTMLElement).dataset.id!);
        const newOrder = [...otherIds];
        newOrder.splice(Math.min(insertIdx, newOrder.length), 0, dragId);
        onReorderRef.current(dragId, newOrder);
      }

      ghostRef.current = null;
      containerRef.current = null;
      draggingIdRef.current = null;
      placeholderIdxRef.current = 0;
      document.body.style.userSelect = "";
      document.body.style.webkitUserSelect = "";
      setSnap(null);
    };

    document.addEventListener("pointermove", handleMove);
    document.addEventListener("pointerup", handleUp);
    document.addEventListener("pointercancel", cleanup);

    return () => {
      document.removeEventListener("pointermove", handleMove);
      document.removeEventListener("pointerup", handleUp);
      document.removeEventListener("pointercancel", cleanup);
    };
  }, [snap?.draggingId, cleanup, resolveItems]);

  // ── per-item bind ────────────────────────────────────────

  const bind = useCallback(
    (itemId: string) => ({
      onPointerDown: (e: React.PointerEvent) => {
        if (!enabled || e.button !== 0) return;
        didActivate.current = false;
        const el = e.currentTarget as HTMLElement;
        pendingRef.current = { el, x: e.clientX, y: e.clientY };
        timerRef.current = setTimeout(() => {
          timerRef.current = null;
          if (pendingRef.current) {
            startDrag(itemId, pendingRef.current);
            pendingRef.current = null;
          }
        }, delay);
      },
      onPointerMove: (e: React.PointerEvent) => {
        if (!pendingRef.current || draggingIdRef.current) return;
        const dx = e.clientX - pendingRef.current.x;
        const dy = e.clientY - pendingRef.current.y;
        if (dx * dx + dy * dy > moveThreshold * moveThreshold) {
          clearTimer();
          pendingRef.current = null;
        }
      },
      onPointerUp: () => {
        if (!draggingIdRef.current) {
          clearTimer();
          pendingRef.current = null;
        }
      },
      onPointerCancel: () => {
        if (!draggingIdRef.current) {
          clearTimer();
          pendingRef.current = null;
        }
      },
    }),
    [enabled, delay, moveThreshold, clearTimer, startDrag],
  );

  return {
    draggingId: snap?.draggingId ?? null,
    placeholderIdx: snap?.placeholderIdx ?? -1,
    placeholderHeight: snap?.placeholderHeight ?? 0,
    bind,
    didActivate,
  };
}
