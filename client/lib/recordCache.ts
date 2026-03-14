/**
 * RecordCache — IDB cache for PomodoroLog + Interruptions
 * Uses EntityStore IDB primitives (put, get, getAll, getByIndex, remove)
 * and event system (emit, on, off). Does NOT use EntityStore sync.
 */

import * as EntityStore from "./entityStore";
import type { PomodoroRecord, InterruptionRecord, TodayStats } from "../types";

// =========================================================
// Constants
// =========================================================

const STORE_RECORDS = "pomodoroRecords";
const STORE_INTERRUPTIONS = "interruptionRecords";
const EVENT_CHANGED = "recordCacheChanged";

// =========================================================
// State
// =========================================================

let _oldestCachedDate: string | null = null;

// =========================================================
// Registration (call before EntityStore.init)
// =========================================================

export function registerStores(): void {
  EntityStore.register(STORE_RECORDS, {
    keyPath: "id",
    indexes: [
      { name: "date", keyPath: "date", options: { unique: false } },
      { name: "taskId", keyPath: "taskId", options: { unique: false } },
    ],
  });
  EntityStore.register(STORE_INTERRUPTIONS, {
    keyPath: "id",
    indexes: [{ name: "pomodoroId", keyPath: "pomodoroId", options: { unique: false } }],
  });
}

// =========================================================
// Populate (bulk load from server)
// =========================================================

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + days);
  return (
    d.getFullYear() +
    "-" +
    String(d.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(d.getDate()).padStart(2, "0")
  );
}

export async function populateFromBulk(
  records: PomodoroRecord[],
  interruptions: InterruptionRecord[],
): Promise<void> {
  // Clear existing stores in parallel (IDB native clear, single operation)
  await Promise.all([EntityStore.clear(STORE_RECORDS), EntityStore.clear(STORE_INTERRUPTIONS)]);

  // Batch insert (single transaction per store, parallel across stores)
  await Promise.all([
    EntityStore.putBatch(STORE_RECORDS, records),
    EntityStore.putBatch(STORE_INTERRUPTIONS, interruptions),
  ]);

  // Compute oldestCachedDate = day after the oldest record's date
  if (records.length > 0) {
    let oldest = records[0].date;
    for (const r of records) {
      if (r.date < oldest) oldest = r.date;
    }
    _oldestCachedDate = addDays(oldest, 1);
  } else {
    _oldestCachedDate = null;
  }

  EntityStore.emit(EVENT_CHANGED, { op: "populate" });
}

export async function populateFromServerResponse(
  _dateStr: string,
  records: PomodoroRecord[],
  interruptions: InterruptionRecord[],
): Promise<void> {
  // Upsert records for this date (batch per store, parallel across stores)
  await Promise.all([
    EntityStore.putBatch(STORE_RECORDS, records),
    EntityStore.putBatch(STORE_INTERRUPTIONS, interruptions),
  ]);
  EntityStore.emit(EVENT_CHANGED, { op: "populate", dateStr: _dateStr });
}

// =========================================================
// Read
// =========================================================

export function getRecordsByDate(dateStr: string): Promise<PomodoroRecord[]> {
  return EntityStore.getByIndex(STORE_RECORDS, "date", dateStr);
}

export function getRecordsByTaskId(taskId: string): Promise<PomodoroRecord[]> {
  return EntityStore.getByIndex(STORE_RECORDS, "taskId", taskId);
}

export async function getInterruptionsByPomodoroIds(
  pomodoroIds: string[],
): Promise<InterruptionRecord[]> {
  const results: InterruptionRecord[] = [];
  for (const pid of pomodoroIds) {
    const ints = await EntityStore.getByIndex(STORE_INTERRUPTIONS, "pomodoroId", pid);
    results.push(...ints);
  }
  return results;
}

export function hasRecordsForDate(dateStr: string): boolean {
  if (!_oldestCachedDate) return false;
  return dateStr >= _oldestCachedDate;
}

export function getOldestCachedDate(): string | null {
  return _oldestCachedDate;
}

// =========================================================
// Write (write-through: call after server confirms)
// =========================================================

export async function upsertRecord(record: PomodoroRecord): Promise<void> {
  await EntityStore.put(STORE_RECORDS, record);
  EntityStore.emit(EVENT_CHANGED, { op: "upsert", dateStr: record.date, id: record.id });
}

export async function upsertInterruptions(interruptions: InterruptionRecord[]): Promise<void> {
  await EntityStore.putBatch(STORE_INTERRUPTIONS, interruptions);
  if (interruptions.length > 0) {
    EntityStore.emit(EVENT_CHANGED, { op: "upsert" });
  }
}

// =========================================================
// Stats computation (client-side)
// =========================================================

export async function computeStatsForDate(dateStr: string): Promise<TodayStats> {
  const records = await getRecordsByDate(dateStr);
  const stats: TodayStats = {
    completedPomodoros: 0,
    abandonedPomodoros: 0,
    totalWorkSeconds: 0,
    totalBreakSeconds: 0,
    totalWorkInterruptionSeconds: 0,
    totalNonWorkInterruptionSeconds: 0,
  };

  for (const r of records) {
    if (r.type === "work") {
      if (r.completionStatus === "completed") stats.completedPomodoros++;
      else if (r.completionStatus === "abandoned") stats.abandonedPomodoros++;
      stats.totalWorkSeconds +=
        r.actualDurationSeconds - r.workInterruptionSeconds - r.nonWorkInterruptionSeconds;
      stats.totalWorkInterruptionSeconds += r.workInterruptionSeconds;
      stats.totalNonWorkInterruptionSeconds += r.nonWorkInterruptionSeconds;
    } else if (r.type === "shortBreak" || r.type === "longBreak") {
      stats.totalBreakSeconds += r.actualDurationSeconds;
    }
  }

  return stats;
}

// =========================================================
// Week counts (from IDB)
// =========================================================

export async function getWeekRecordCounts(weekStartDate: string): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (let i = 0; i < 7; i++) {
    const d = addDays(weekStartDate, i);
    counts[d] = 0;
  }

  for (const dateStr of Object.keys(counts)) {
    const records = await getRecordsByDate(dateStr);
    counts[dateStr] = records.filter((r) => r.type === "work").length;
  }

  return counts;
}

// =========================================================
// Event helpers
// =========================================================

export function on(cb: (data: any) => void): void {
  EntityStore.on(EVENT_CHANGED, cb);
}

export function off(cb: (data: any) => void): void {
  EntityStore.off(EVENT_CHANGED, cb);
}
