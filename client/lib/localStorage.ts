/**
 * localStorage helpers — maintain the same keys as the original IIFE code
 */

export const STORAGE_KEYS = {
  TIMER_STATE: "gas_pomodoro_state",
  MEMO_ACTIVE: "gas_pomodoro_memo_active",
  LEFT_COLLAPSED: "gas_pomodoro_left_collapsed",
  MEMO_SIDEBAR_COLLAPSED: "gas_pomodoro_memo_sidebar_collapsed",
  TASK_SIDEBAR_COLLAPSED: "gas_pomodoro_task_sidebar_collapsed",
  RECORD_DESC: "gas_pomodoro_record_desc",
  INT_NOTE: "gas_pomodoro_int_note",
  TASK_SELECTED: "gas_pomodoro_task_selected",
} as const;

export function lsGet(key: string): string {
  try {
    return localStorage.getItem(key) || "";
  } catch {
    return "";
  }
}

export function lsSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // localStorage not available or full
  }
}

export function lsRemove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // localStorage not available
  }
}

export function lsGetJSON<T>(key: string): T | null {
  const raw = lsGet(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function lsSetJSON(key: string, value: unknown): void {
  try {
    lsSet(key, JSON.stringify(value));
  } catch {
    // serialization failure
  }
}
