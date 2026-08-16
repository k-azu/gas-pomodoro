import { useCallback, useState } from "react";
import { lsGet, lsSet } from "../lib/localStorage";

export const DEFAULT_SIDEBAR_WIDTH = 260;
export const MIN_SIDEBAR_WIDTH = 180;
export const MAX_SIDEBAR_WIDTH = 480;

export function clampSidebarWidth(width: number): number {
  return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, Math.round(width)));
}

function readSidebarWidth(storageKey: string): number {
  const saved = lsGet(storageKey);
  if (!saved) return DEFAULT_SIDEBAR_WIDTH;

  const parsed = Number(saved);
  return Number.isFinite(parsed) ? clampSidebarWidth(parsed) : DEFAULT_SIDEBAR_WIDTH;
}

/** Keeps drag updates responsive and persists only the final width. */
export function useSidebarWidth(storageKey: string) {
  const [width, setWidth] = useState(() => readSidebarWidth(storageKey));

  const onWidthChange = useCallback((nextWidth: number) => {
    setWidth(clampSidebarWidth(nextWidth));
  }, []);

  const onWidthChangeEnd = useCallback(
    (nextWidth: number) => {
      const clampedWidth = clampSidebarWidth(nextWidth);
      setWidth(clampedWidth);
      lsSet(storageKey, String(clampedWidth));
    },
    [storageKey],
  );

  return { width, onWidthChange, onWidthChangeEnd };
}
