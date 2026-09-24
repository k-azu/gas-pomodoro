/**
 * Due-date helpers for task lists: highlight overdue / due-today tasks and flag a due date
 * that precedes the start date. Dates are "YYYY-MM-DD" (a longer ISO string is truncated).
 */

export type DueState = "overdue" | "today" | null;

/** Statuses whose due date no longer matters (finished work or reference documents). */
const DUE_EXEMPT_STATUSES = new Set(["done", "docs"]);

function dateOnly(value: string | undefined | null): string {
  return value ? value.slice(0, 10) : "";
}

export function formatLocalDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function getDueState(
  task: { status: string; dueDate?: string | null },
  today: string = formatLocalDate(new Date()),
): DueState {
  const due = dateOnly(task.dueDate);
  if (!due || DUE_EXEMPT_STATUSES.has(task.status)) return null;
  if (due < today) return "overdue";
  if (due === today) return "today";
  return null;
}

/** True when both dates are set and the due date is earlier than the start date. */
export function isDueBeforeStart(task: {
  startedAt?: string | null;
  dueDate?: string | null;
}): boolean {
  const start = dateOnly(task.startedAt);
  const due = dateOnly(task.dueDate);
  return Boolean(start && due && due < start);
}

export const DUE_BEFORE_START_MESSAGE = "期限が開始日より前です";
