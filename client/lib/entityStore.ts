/**
 * EntityStore — IndexedDB CRUD + server sync + event system
 * Port of EntityStore.html IIFE → TypeScript class with identical behavior.
 *
 * Backward-compatible: same IDB name/version, same _dirty/_pendingCreate fields,
 * same sync timing (metadata 1s, content 30s, reorder 5s).
 */

import { serverCall } from "./serverCall";

// =========================================================
// Debug Logging
// =========================================================

let _debugSync = true;

/** Enable/disable sync debug logging. Call `EntityStore.setDebugSync(true)` from DevTools. */
export function setDebugSync(enabled: boolean): void {
  _debugSync = enabled;
}

function logSync(tag: string, ...args: unknown[]): void {
  if (_debugSync) console.log(`%c[Sync] ${tag}`, "color: #4285f4", ...args);
}

// =========================================================
// Types
// =========================================================

export interface StoreIndex {
  name: string;
  keyPath: string;
  options?: IDBIndexParameters;
}

export interface StoreRegistration {
  storeName?: string;
  entityType?: string;
  keyPath?: string;
  indexes?: StoreIndex[];
  serverFns?: {
    add?: string;
    update?: string;
    archive?: string;
    getContent?: string;
    reorder?: string;
  };
  addServerArgs?: (entity: any) => unknown[];
  contentSyncFn?: (id: string, content: string) => Promise<any>;
  onUpdateHook?: (item: any, fields: Record<string, any>) => void;
}

export interface DataChangedEvent {
  entityType: string;
  op: string;
  id?: string;
}

type EventCallback = (data: any) => void;

// =========================================================
// Module State
// =========================================================

let _db: IDBDatabase | null = null;
let _dbName: string | null = null;
let _dbVersion: number | null = null;
let _onUpgrade: ((db: IDBDatabase, oldVersion: number, newVersion: number | null) => void) | null =
  null;

const _listeners: Record<string, EventCallback[]> = {};
const _entityStoreMap: Record<string, string> = {}; // id -> storeName
const _registrations: Record<string, StoreRegistration> = {};
const _metaDebounces: Record<string, ReturnType<typeof setTimeout>> = {};
const _contentSyncDebounces: Record<string, ReturnType<typeof setTimeout>> = {};
const _reorderState: Record<string, { pending: unknown[] | null; saving: boolean }> = {};
const _reorderDebounces: Record<string, ReturnType<typeof setTimeout>> = {};
const _pendingServerContent: Record<string, { content: string; serverTs: string }> = {};
const _pendingOps: Record<string, Promise<any>> = {};

// =========================================================
// Per-ID operation lock (serializes read-modify-write)
// =========================================================

function withLock(id: string, fn: () => Promise<any>): Promise<any> {
  const prev = _pendingOps[id] || Promise.resolve();
  const next = prev.then(fn, fn);
  _pendingOps[id] = next;
  next.then(() => {
    if (_pendingOps[id] === next) delete _pendingOps[id];
  });
  return next;
}

// =========================================================
// Registration & Init
// =========================================================

export function register(storeName: string, config: StoreRegistration): void {
  config.storeName = storeName;
  _registrations[storeName] = config;
  _reorderState[storeName] = { pending: null, saving: false };
}

export function init(
  dbName: string,
  dbVersion: number,
  opts?: { onUpgrade?: (db: IDBDatabase, oldVersion: number, newVersion: number | null) => void },
): Promise<void> {
  _dbName = dbName;
  _dbVersion = dbVersion;
  _onUpgrade = opts?.onUpgrade ?? null;
  return openDB().then(() => {
    window.addEventListener("beforeunload", (e) => {
      const pending = hasPendingChanges();
      flushAllSyncs();
      if (pending) {
        e.preventDefault();
        e.returnValue = "";
      }
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flushAllSyncs();
    });
  });
}

// =========================================================
// IndexedDB Setup
// =========================================================

function openDB(): Promise<IDBDatabase> {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(_dbName!, _dbVersion!);
    } catch (e) {
      console.error("[EntityStore] indexedDB.open threw:", e);
      reject(e);
      return;
    }
    req.onupgradeneeded = (event) => {
      const db = req.result;
      Object.keys(_registrations).forEach((storeName) => {
        const cfg = _registrations[storeName];
        if (!db.objectStoreNames.contains(storeName)) {
          const store = db.createObjectStore(storeName, { keyPath: cfg.keyPath || "id" });
          (cfg.indexes || []).forEach((idx) => {
            store.createIndex(idx.name, idx.keyPath, idx.options || { unique: false });
          });
        }
      });
      if (_onUpgrade)
        _onUpgrade(
          db,
          (event as IDBVersionChangeEvent).oldVersion,
          (event as IDBVersionChangeEvent).newVersion,
        );
    };
    req.onsuccess = () => {
      _db = req.result;
      console.log("[EntityStore] IndexedDB opened successfully");
      resolve(_db!);
    };
    req.onerror = () => {
      console.error("[EntityStore] IndexedDB open failed:", req.error);
      reject(req.error);
    };
    req.onblocked = () => {
      console.warn("[EntityStore] IndexedDB open blocked (another connection open?)");
    };
  });
}

// =========================================================
// Core DB functions
// =========================================================

export function getAll(storeName: string): Promise<any[]> {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, "readonly");
        const req = tx.objectStore(storeName).getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export function get(storeName: string, id: string): Promise<any | null> {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, "readonly");
        const req = tx.objectStore(storeName).get(id);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => {
          console.error("[EntityStore] get failed:", storeName, id, req.error);
          reject(req.error);
        };
      }),
  );
}

export function put(storeName: string, data: any): Promise<void> {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, "readwrite");
        tx.objectStore(storeName).put(data);
        tx.oncomplete = () => resolve();
        tx.onerror = () => {
          console.error("[EntityStore] put failed:", storeName, data?.id, tx.error);
          reject(tx.error);
        };
      }),
  );
}

export function remove(storeName: string, id: string): Promise<void> {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, "readwrite");
        tx.objectStore(storeName).delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      }),
  );
}

export function getByIndex(storeName: string, indexName: string, val: string): Promise<any[]> {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, "readonly");
        const idx = tx.objectStore(storeName).index(indexName);
        const req = idx.getAll(val);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

// =========================================================
// Event System
// =========================================================

export function on(event: string, cb: EventCallback): void {
  if (!_listeners[event]) _listeners[event] = [];
  _listeners[event].push(cb);
}

export function off(event: string, cb: EventCallback): void {
  const cbs = _listeners[event];
  if (!cbs) return;
  const idx = cbs.indexOf(cb);
  if (idx !== -1) cbs.splice(idx, 1);
}

export function emit(event: string, data?: any): void {
  const cbs = _listeners[event] || [];
  cbs.forEach((cb) => {
    try {
      cb(data);
    } catch (e) {
      console.error("EntityStore event error:", e);
    }
  });
}

// =========================================================
// Generic CRUD
// =========================================================

export function addEntity(storeName: string, entityData: Record<string, any>): Promise<string> {
  const now = new Date().toISOString();
  const item: any = {
    sortOrder: Date.now(),
    isActive: true,
    createdAt: now,
    updatedAt: now,
    content: "",
    _dirty: true,
    _pendingCreate: true,
    ...entityData,
  };
  _entityStoreMap[item.id] = storeName;
  return put(storeName, item).then(() => {
    const cfg = _registrations[storeName];
    emit("dataChanged", { entityType: cfg?.entityType || storeName, op: "add", id: item.id });
    syncCreateToServer(storeName, item.id);
    return item.id;
  });
}

export function updateEntityFields(
  storeName: string,
  id: string,
  fields: Record<string, any>,
): Promise<void> {
  _entityStoreMap[id] = storeName;
  return withLock(id, () =>
    get(storeName, id).then((item) => {
      if (!item) return;
      const cfg = _registrations[storeName];
      if (cfg?.onUpdateHook) cfg.onUpdateHook(item, fields);
      Object.keys(fields).forEach((k) => {
        item[k] = fields[k];
      });
      item.updatedAt = new Date().toISOString();
      item._dirty = true;
      return put(storeName, item).then(() => {
        emit("dataChanged", { entityType: cfg?.entityType || storeName, op: "update", id });
        scheduleMetadataSync(storeName, id);
      });
    }),
  );
}

export function updateEntityRaw(
  storeName: string,
  id: string,
  mergeFn: (item: any) => void,
): Promise<void> {
  return withLock(id, () =>
    get(storeName, id).then((item) => {
      if (!item) return;
      mergeFn(item);
      return put(storeName, item);
    }),
  );
}

export function updateSortOrders(
  storeName: string,
  entries: Array<{ id: string; sortOrder: number }>,
): Promise<void> {
  return Promise.all(
    entries.map((e) => {
      _entityStoreMap[e.id] = storeName;
      return withLock(e.id, () =>
        get(storeName, e.id).then((item) => {
          if (!item) return;
          item.sortOrder = e.sortOrder;
          item._dirty = true;
          return put(storeName, item);
        }),
      ).catch((err) => {
        console.error("[EntityStore] updateSortOrders partial failure:", e.id, err);
      });
    }),
  ).then(() => {});
}

export function setInactive(storeName: string, id: string): Promise<void> {
  _entityStoreMap[id] = storeName;
  return withLock(id, () =>
    get(storeName, id).then((item) => {
      if (!item) return;
      item.isActive = false;
      item._dirty = true;
      return put(storeName, item);
    }),
  );
}

export function archiveEntity(storeName: string, id: string): Promise<void> {
  _entityStoreMap[id] = storeName;
  return setInactive(storeName, id).then(() => {
    const cfg = _registrations[storeName];
    emit("dataChanged", { entityType: cfg?.entityType || storeName, op: "archive", id });
    syncArchiveToServer(storeName, id);
  });
}

// =========================================================
// Content Management
// =========================================================

export function saveContent(
  storeName: string,
  id: string,
  content: string,
  opts?: { immediateSync?: boolean },
): Promise<void> {
  _entityStoreMap[id] = storeName;
  return withLock(id, () =>
    get(storeName, id).then((existing) => {
      if (!existing) return;
      logSync("saveContent → IDB", storeName, id, `${content.length} chars`);
      if (!content && !existing._serverUpdatedAt && !existing._pendingCreate) {
        console.warn("[EntityStore] Skipping empty content save for unconfirmed entity:", id);
        return;
      }
      const now = new Date().toISOString();
      existing.content = content;
      existing._contentDirtyAt = now;
      return put(storeName, existing).then(() => {
        if (opts?.immediateSync) {
          if (_contentSyncDebounces[id]) {
            clearTimeout(_contentSyncDebounces[id]);
            delete _contentSyncDebounces[id];
          }
          syncContentToServer(storeName, id);
        } else {
          scheduleContentSync(storeName, id);
        }
      });
    }),
  );
}

export function getContent(storeName: string, id: string): Promise<string | null> {
  return get(storeName, id).then((record) => {
    if (!record) return null;
    return record.content != null ? record.content : "";
  });
}

// =========================================================
// Sync Utilities
// =========================================================

function stripLocalFields(obj: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {};
  Object.keys(obj).forEach((k) => {
    if (k.charAt(0) !== "_") result[k] = obj[k];
  });
  return result;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

function retryWithBackoff(fn: () => Promise<any>, maxRetries = 5): Promise<any> {
  function attempt(n: number): Promise<any> {
    return fn().catch((err) => {
      if (n >= maxRetries) {
        emit("syncError", { error: err });
        throw err;
      }
      const delay = Math.pow(2, n) * 1000;
      return new Promise((resolve) => setTimeout(resolve, delay)).then(() => attempt(n + 1));
    });
  }
  return attempt(0);
}

// =========================================================
// Write Sync: IDB → Server
// =========================================================

function syncCreateToServer(storeName: string, id: string): void {
  get(storeName, id)
    .then((entity) => {
      if (!entity || !entity._pendingCreate) return;
      const capturedUpdatedAt = entity.updatedAt;
      const cfg = _registrations[storeName];
      if (!cfg?.serverFns?.add) return;
      logSync("create → server", storeName, id);
      const args = cfg.addServerArgs!(entity);
      return retryWithBackoff(() => serverCall(cfg.serverFns!.add!, ...args)).then((result: any) =>
        withLock(id, () =>
          get(storeName, id).then((latest) => {
            if (!latest) return;
            latest._pendingCreate = false;
            latest._serverUpdatedAt = result.updatedAt;
            if (latest.updatedAt === capturedUpdatedAt) {
              latest._dirty = false;
            }
            return put(storeName, latest);
          }),
        ),
      );
    })
    .catch((err) => {
      console.error("[EntityStore] syncCreateToServer failed:", storeName, id, err);
    });
}

function scheduleMetadataSync(storeName: string, id: string): void {
  if (_metaDebounces[id]) clearTimeout(_metaDebounces[id]);
  _metaDebounces[id] = setTimeout(() => {
    delete _metaDebounces[id];
    syncMetadataToServer(storeName, id);
  }, 1000);
}

function syncMetadataToServer(storeName: string, id: string): void {
  get(storeName, id)
    .then((entity) => {
      if (!entity) return;
      if (entity._pendingCreate) return;
      const capturedUpdatedAt = entity.updatedAt;
      const cfg = _registrations[storeName];
      if (!cfg?.serverFns?.update) return;
      logSync("metadata → server", storeName, id);
      const clean = stripLocalFields(entity);
      delete clean.id;
      delete clean.createdAt;
      delete clean.content;
      return retryWithBackoff(() => serverCall(cfg.serverFns!.update!, id, clean)).then(
        (result: any) => {
          if (!result?.updatedAt) return;
          return withLock(id, () =>
            get(storeName, id).then((latest) => {
              if (!latest) return;
              latest._serverUpdatedAt = result.updatedAt;
              if (latest.updatedAt === capturedUpdatedAt) {
                latest._dirty = false;
              }
              return put(storeName, latest);
            }),
          );
        },
      );
    })
    .catch((err) => {
      console.error("[EntityStore] syncMetadataToServer failed:", storeName, id, err);
    });
}

export function syncArchiveToServer(storeName: string, id: string): void {
  get(storeName, id)
    .then((entity) => {
      if (!entity) return;
      if (entity._pendingCreate) return;
      const cfg = _registrations[storeName];
      if (!cfg?.serverFns?.archive) return;
      logSync("archive → server", storeName, id);
      return retryWithBackoff(() => serverCall(cfg.serverFns!.archive!, id)).then(() =>
        withLock(id, () =>
          get(storeName, id).then((latest) => {
            if (!latest) return;
            latest._dirty = false;
            return put(storeName, latest);
          }),
        ),
      );
    })
    .catch((err) => {
      console.error("[EntityStore] syncArchiveToServer failed:", storeName, id, err);
    });
}

function scheduleContentSync(storeName: string, id: string): void {
  if (_contentSyncDebounces[id]) clearTimeout(_contentSyncDebounces[id]);
  _contentSyncDebounces[id] = setTimeout(() => {
    delete _contentSyncDebounces[id];
    syncContentToServer(storeName, id);
  }, 30000);
}

export function flushContentSync(storeName: string, id: string): void {
  if (_contentSyncDebounces[id]) {
    clearTimeout(_contentSyncDebounces[id]);
    delete _contentSyncDebounces[id];
  }
  syncContentToServer(storeName, id);
}

function syncContentToServer(storeName: string, id: string): void {
  get(storeName, id)
    .then((entity) => {
      if (!entity) return;
      if (entity._pendingCreate) return;
      if (!entity._contentDirtyAt) return;
      const cfg = _registrations[storeName];
      if (!cfg?.serverFns) return;
      const content = entity.content || "";
      logSync("content → server", storeName, id, `${content.length} chars`);
      const capturedDirtyAt = entity._contentDirtyAt;

      let syncFn: () => Promise<any>;
      if (cfg.contentSyncFn) {
        syncFn = () => cfg.contentSyncFn!(id, content);
      } else if (cfg.serverFns.update) {
        syncFn = () => serverCall(cfg.serverFns!.update!, id, { content });
      } else {
        return;
      }

      return retryWithBackoff(syncFn).then((result: any) => {
        const serverUpdatedAt = result?.updatedAt;
        return withLock(id, () =>
          get(storeName, id).then((latest) => {
            if (!latest) return;
            if (latest._contentDirtyAt === capturedDirtyAt) {
              latest._contentDirtyAt = null;
            }
            if (serverUpdatedAt) latest._serverUpdatedAt = serverUpdatedAt;
            return put(storeName, latest);
          }),
        );
      });
    })
    .catch((err) => {
      console.error("[EntityStore] syncContentToServer failed:", storeName, id, err);
    });
}

export function scheduleReorderSync(storeName: string, args: unknown[]): void {
  const state = _reorderState[storeName];
  if (!state) return;
  state.pending = args;
  if (_reorderDebounces[storeName]) clearTimeout(_reorderDebounces[storeName]);
  _reorderDebounces[storeName] = setTimeout(() => {
    delete _reorderDebounces[storeName];
    flushReorderSync(storeName);
  }, 5000);
}

function flushReorderSync(storeName: string): void {
  const state = _reorderState[storeName];
  if (!state) return;
  if (state.saving) return;
  if (!state.pending) return;
  const args = state.pending;
  state.pending = null;
  state.saving = true;
  const cfg = _registrations[storeName];
  if (!cfg?.serverFns?.reorder) {
    state.saving = false;
    return;
  }
  serverCall(cfg.serverFns.reorder, ...args)
    .catch((err) => {
      console.error("[EntityStore] reorder sync failed:", storeName, err);
    })
    .then(() => {
      state.saving = false;
      if (state.pending) flushReorderSync(storeName);
    });
}

/** Returns true if any debounced sync (metadata/content/reorder) is still pending. */
export function hasPendingChanges(): boolean {
  return (
    Object.keys(_metaDebounces).length > 0 ||
    Object.keys(_contentSyncDebounces).length > 0 ||
    Object.values(_reorderState).some((s) => s.pending !== null)
  );
}

export function flushAllSyncs(): void {
  logSync("flushAll");
  Object.keys(_metaDebounces).forEach((id) => {
    clearTimeout(_metaDebounces[id]);
    delete _metaDebounces[id];
    const storeName = _entityStoreMap[id];
    if (storeName) syncMetadataToServer(storeName, id);
  });
  Object.keys(_contentSyncDebounces).forEach((id) => {
    clearTimeout(_contentSyncDebounces[id]);
    delete _contentSyncDebounces[id];
    const storeName = _entityStoreMap[id];
    if (storeName) syncContentToServer(storeName, id);
  });
  Object.keys(_reorderState).forEach((sn) => {
    if (_reorderDebounces[sn]) {
      clearTimeout(_reorderDebounces[sn]);
      delete _reorderDebounces[sn];
    }
    flushReorderSync(sn);
  });
}

// =========================================================
// Read Sync: Server → IDB
// =========================================================

export function mergeServerData(storeName: string, serverEntities: any[]): Promise<void> {
  return getAll(storeName).then((localEntities) => {
    const localMap: Record<string, any> = {};
    localEntities.forEach((e) => {
      localMap[e.id] = e;
    });
    const serverMap: Record<string, any> = {};
    serverEntities.forEach((e) => {
      serverMap[e.id] = e;
    });

    const ops: Promise<any>[] = [];

    // 1. Server only → insert into IDB
    serverEntities.forEach((se) => {
      if (!localMap[se.id]) {
        se._serverUpdatedAt = se.updatedAt;
        se._contentDirtyAt = null;
        const pending = _pendingServerContent[se.id];
        if (pending) {
          se.content = pending.content;
          delete _pendingServerContent[se.id];
        } else {
          se.content = "";
        }
        ops.push(put(storeName, se));
      }
    });

    // 2. Local only
    localEntities.forEach((le) => {
      if (!serverMap[le.id]) {
        if (!le._serverUpdatedAt) {
          ops.push(
            withLock(le.id, () =>
              get(storeName, le.id).then((latest) => {
                if (!latest) return;
                latest._pendingCreate = true;
                latest._dirty = true;
                if (latest.content == null) latest.content = "";
                return put(storeName, latest);
              }),
            ).then(() => {
              syncCreateToServer(storeName, le.id);
            }),
          );
        } else {
          ops.push(remove(storeName, le.id));
        }
      }
    });

    // 3. Both exist
    serverEntities.forEach((se) => {
      const le = localMap[se.id];
      if (!le) return;
      _entityStoreMap[se.id] = storeName;
      if (!le._dirty) {
        const merged: any = { ...se };
        Object.keys(le).forEach((k) => {
          if (k.charAt(0) === "_" || k === "content") {
            if (k.startsWith("_cached")) return; // サーバー値を優先
            merged[k] = le[k];
          }
        });
        merged._serverUpdatedAt = se.updatedAt;
        merged._dirty = false;
        ops.push(put(storeName, merged));
      } else {
        ops.push(
          withLock(se.id, () =>
            get(storeName, se.id).then((latest) => {
              if (!latest) return;
              latest._serverUpdatedAt = se.updatedAt;
              return put(storeName, latest);
            }),
          ),
        );
        scheduleMetadataSync(storeName, se.id);
      }
    });

    return Promise.all(ops).then(() => {});
  });
}

export function requeueDirtyRecords(storeName: string): void {
  getAll(storeName)
    .then((entities) => {
      entities.forEach((entity) => {
        _entityStoreMap[entity.id] = storeName;
        if (entity._pendingCreate) {
          syncCreateToServer(storeName, entity.id);
        } else if (entity._dirty) {
          scheduleMetadataSync(storeName, entity.id);
        }
        if (entity._contentDirtyAt) {
          scheduleContentSync(storeName, entity.id);
        }
      });
    })
    .catch((err) => {
      console.warn("[EntityStore] requeueDirtyRecords error:", storeName, err);
    });
}

// =========================================================
// Content Conflict Resolution
// =========================================================

function applyServerContent(
  storeName: string,
  id: string,
  content: string,
  serverTs: string,
): Promise<void> {
  return withLock(id, () =>
    get(storeName, id).then((entity) => {
      if (!entity) return;
      entity.content = content;
      entity._contentDirtyAt = null;
      entity._serverUpdatedAt = serverTs;
      return put(storeName, entity);
    }),
  );
}

function resolveContentConflict(
  storeName: string,
  id: string,
  serverResult: any,
): Promise<{ useServer: boolean; content?: string } | null> {
  if (serverResult == null) {
    return get(storeName, id).then((entity) => {
      if (entity?.content) {
        return { useServer: false };
      }
      return null;
    });
  }

  const serverContent = serverResult.content || "";
  const serverTs = serverResult.updatedAt || "";

  return get(storeName, id).then((entity) => {
    if (!entity) {
      if (!serverContent) return { useServer: false };
      _pendingServerContent[id] = { content: serverContent, serverTs };
      // エンティティ未存在時も contentResolved を発火
      const cfg = _registrations[storeName];
      emit("contentResolved", {
        entityType: cfg?.entityType || storeName,
        id,
        content: serverContent,
      });
      return { useServer: true, content: serverContent };
    }

    const localContent = entity.content || "";

    if (localContent === serverContent) {
      return applyServerContent(storeName, id, localContent, serverTs).then(() => ({
        useServer: false,
      }));
    }

    if (entity._contentDirtyAt) {
      logSync("resolve: local dirty, keep local", storeName, id);
      scheduleContentSync(storeName, id);
      return { useServer: false };
    }

    logSync("resolve: use server content", storeName, id, `${serverContent.length} chars`);
    return applyServerContent(storeName, id, serverContent, serverTs).then(() => {
      const cfg = _registrations[storeName];
      emit("contentResolved", {
        entityType: cfg?.entityType || storeName,
        id,
        content: serverContent,
      });
      return { useServer: true, content: serverContent };
    });
  });
}

export function resolveWithServer(
  storeName: string,
  id: string,
): Promise<{ useServer: boolean; content?: string } | null> {
  const cfg = _registrations[storeName];
  if (!cfg?.serverFns?.getContent) {
    return Promise.resolve(null);
  }
  logSync("resolve ← server", storeName, id);
  function attempt(): Promise<{ useServer: boolean; content?: string } | null> {
    return withTimeout(serverCall(cfg.serverFns!.getContent!, id), 30000).then((serverResult) =>
      resolveContentConflict(storeName, id, serverResult),
    );
  }
  return attempt()
    .catch((err) => {
      console.warn("[EntityStore] resolveWithServer attempt 1 failed, retrying:", id, err);
      return attempt();
    })
    .catch((err) => {
      console.error("[EntityStore] resolveWithServer failed after retry:", id, err);
      throw err;
    });
}

// Re-export withLock for external use
export { withLock };
