/**
 * MemoStore — facade over EntityStore for memo CRUD + tag management
 * Port of MemoStore.html IIFE → TypeScript module.
 */

import * as EntityStore from "./entityStore";
import { serverCall } from "./serverCall";
import type { MemoTag, MemoMetadata } from "../types";

let _memoTags: MemoTag[] = [];
let _serverMemos: MemoMetadata[] | null = null;

// =========================================================
// Init: register "memos" entity type
// =========================================================

export function init(serverMemos: MemoMetadata[], serverMemoTags: MemoTag[]): void {
  _memoTags = serverMemoTags || [];
  _serverMemos = serverMemos;

  EntityStore.register("memos", {
    entityType: "memo",
    keyPath: "id",
    indexes: [],
    serverFns: {
      add: "saveMemo",
      archive: "deleteMemo",
      getContent: "getMemoContent",
      reorder: "updateMemoSortOrders",
    },
    addServerArgs: (e: any) => [{ id: e.id, name: e.name, content: "", tags: e.tags || [] }],
    contentSyncFn: (id: string, content: string) =>
      serverCall("saveMemoContent", id, content, new Date().toISOString()) as Promise<any>,
  });
}

// =========================================================
// Load data: merge server data into IDB + migrate localStorage
// =========================================================

export function loadData(): Promise<void> {
  const serverMemos = _serverMemos || [];
  _serverMemos = null;
  return EntityStore.mergeServerData("memos", serverMemos)
    .then(() => {
      EntityStore.requeueDirtyRecords("memos");
      return migrateFromLocalStorage(serverMemos);
    })
    .then(() => {
      EntityStore.emit("dataChanged", { entityType: "memo", op: "serverSync" });
    });
}

// =========================================================
// localStorage → IDB migration (one-time, idempotent)
// =========================================================

const LS_CONTENT_PREFIX = "gas_pomodoro_memo_";
const LS_TS_PREFIX = "gas_pomodoro_memo_ts_";
const LS_SYNCED_PREFIX = "gas_pomodoro_memo_synced_";

function migrateFromLocalStorage(serverMemos: MemoMetadata[]): Promise<void> {
  const memoIds = serverMemos.map((m) => m.id);
  if (memoIds.length === 0) return Promise.resolve();

  const ops: Promise<void>[] = [];
  memoIds.forEach((id) => {
    let lsContent: string | null = null;
    try {
      lsContent = localStorage.getItem(LS_CONTENT_PREFIX + id);
    } catch {
      // ignore
    }
    if (!lsContent) return;

    ops.push(
      EntityStore.getContent("memos", id)
        .then((idbContent) => {
          if (idbContent) return;
          return EntityStore.saveContent("memos", id, lsContent!).then(() => {
            console.log("[MemoStore] Migrated memo from localStorage:", id);
          });
        })
        .then(() => {
          try {
            localStorage.removeItem(LS_CONTENT_PREFIX + id);
            localStorage.removeItem(LS_TS_PREFIX + id);
            localStorage.removeItem(LS_SYNCED_PREFIX + id);
          } catch {
            // ignore
          }
        }),
    );
  });

  return Promise.all(ops)
    .then(() => {})
    .catch((err) => {
      console.warn("[MemoStore] localStorage migration error:", err);
    });
}

// =========================================================
// Query helpers
// =========================================================

export function getMemos(): Promise<any[]> {
  return EntityStore.getAll("memos").then((items) =>
    items
      .filter((m) => m.isActive !== false)
      .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0)),
  );
}

export function getMemo(id: string): Promise<any> {
  return EntityStore.get("memos", id);
}

// =========================================================
// CRUD
// =========================================================

export function addMemo(name: string): Promise<string> {
  return EntityStore.addEntity("memos", {
    id: crypto.randomUUID(),
    name,
    tags: [],
  });
}

export function renameMemo(id: string, name: string): Promise<void> {
  serverCall("renameMemo", id, name).catch(() => {});
  return EntityStore.updateEntityFields("memos", id, { name });
}

export function deleteMemo(id: string): Promise<void> {
  return EntityStore.archiveEntity("memos", id);
}

export function reorderMemos(orderedIds: string[]): Promise<void> {
  const entries = orderedIds.map((id, i) => ({ id, sortOrder: i + 1 }));
  return EntityStore.updateSortOrders("memos", entries).then(() => {
    EntityStore.emit("dataChanged", { entityType: "memo", op: "reorder" });
    EntityStore.scheduleReorderSync("memos", [orderedIds]);
  });
}

// =========================================================
// Tag management
// =========================================================

export function updateTags(id: string, tags: string[]): Promise<void> {
  serverCall("updateMemoTags", id, tags).catch(() => {});
  return EntityStore.updateEntityFields("memos", id, { tags });
}

export function addTag(name: string, color?: string): void {
  const c = color || "#757575";
  const existing = _memoTags.find((t) => t.name === name);
  if (existing) return;
  _memoTags.push({ name, color: c, sortOrder: _memoTags.length + 1, isActive: true });
  serverCall("addMemoTag", name, c).catch(() => {});
}

export function updateTagColor(name: string, color: string): void {
  const tag = _memoTags.find((t) => t.name === name);
  if (tag) tag.color = color;
  serverCall("updateMemoTagColor", name, color).catch(() => {});
}

export function getTags(): MemoTag[] {
  return _memoTags;
}

// =========================================================
// Content (backward compat wrappers)
// =========================================================

export function saveContent(
  id: string,
  content: string,
  opts?: { immediateSync?: boolean },
): Promise<void> {
  return EntityStore.saveContent("memos", id, content, opts);
}

export function getContent(id: string): Promise<string | null> {
  return EntityStore.getContent("memos", id);
}

export function resolveWithServer(id: string) {
  return EntityStore.resolveWithServer("memos", id);
}

export function flushContentSync(id: string): void {
  EntityStore.flushContentSync("memos", id);
}
