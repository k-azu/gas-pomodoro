/**
 * EntityStore — IndexedDB CRUD + server sync + event system
 * Metadata keeps the existing dirty-field workflow. Document bodies use
 * revisioned, per-tab drafts so a tab can never acknowledge another tab's edit.
 */

import { serverCall } from "./serverCall";
import { getTabId, isTabActive, onTabIdChange, publishDocumentCommit } from "./tabSync";

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
  contentSyncFn?: (
    id: string,
    content: string,
    baseRevision: number,
    mutationId: string,
  ) => Promise<any>;
  onUpdateHook?: (item: any, fields: Record<string, any>) => void;
}

export interface DataChangedEvent {
  entityType: string;
  op: string;
  id?: string;
}

export interface ContentSnapshot {
  content: string;
  revision: number;
  dirty: boolean;
  conflict?: ContentConflictSnapshot;
}

export interface ContentConflictSnapshot {
  content: string;
  revision: number;
  updatedAt: string;
}

interface CommittedSnapshot extends ContentSnapshot {
  updatedAt: string;
}

interface AppliedCommittedSnapshot {
  snapshot: CommittedSnapshot;
  applied: boolean;
}

export interface ContentSaveOptions {
  immediateSync?: boolean;
  baseRevision?: number;
  mutationId?: string;
}

interface PendingContentSync {
  storeName: string;
  id: string;
  tabId: string;
  content: string;
  baseRevision: number;
  mutationId: string;
  dirtyAt: string;
  conflict?: ContentConflictSnapshot;
  recoveryState?: "conflicting" | "rejected";
  recoveryReason?: "inactive" | "notFound";
  recoveryWinnerMutationId?: string;
}

export interface RecoveryDraft {
  key: string;
  storeName: string;
  id: string;
  content: string;
  dirtyAt: string;
  recoveryState: "conflicting" | "rejected";
  recoveryReason?: "inactive" | "notFound";
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
const _entityStoreMap: Record<string, { storeName: string; id: string }> = {};
const _registrations: Record<string, StoreRegistration> = {};
const _metaDebounces: Record<string, ReturnType<typeof setTimeout>> = {};
const _contentSyncDebounces: Record<string, ReturnType<typeof setTimeout>> = {};
const _reorderState: Record<string, { pending: unknown[] | null; saving: boolean }> = {};
const _reorderDebounces: Record<string, ReturnType<typeof setTimeout>> = {};
const _pendingServerContent: Record<
  string,
  { content: string; serverTs: string; revision: number }
> = {};
const _pendingOps: Record<string, Promise<any>> = {};
const _pendingContentSyncs: Record<string, PendingContentSync> = {};
const _contentSyncInFlight = new Set<string>();
const _contentSyncRequested = new Set<string>();

const DRAFT_STORE = "documentDrafts";

function scopedKey(storeName: string, id: string): string {
  return `${storeName}:${id}`;
}

function isDev(): boolean {
  return Boolean((import.meta as any).env?.DEV);
}

function rememberEntityStore(storeName: string, id: string): string {
  const key = scopedKey(storeName, id);
  _entityStoreMap[key] = { storeName, id };
  return key;
}

// =========================================================
// Per-ID operation lock (serializes read-modify-write)
// =========================================================

function withLock(storeName: string, id: string, fn: () => Promise<any>): Promise<any> {
  const key = scopedKey(storeName, id);
  const prev = _pendingOps[key] || Promise.resolve();
  const run = () => {
    if (navigator.locks) {
      return navigator.locks.request(`gas-pomodoro:${storeName}:${id}`, fn);
    }
    return fn();
  };
  const next = prev.then(run, run);
  _pendingOps[key] = next;
  const cleanup = () => {
    if (_pendingOps[key] === next) delete _pendingOps[key];
  };
  next.then(cleanup, cleanup);
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
  // Start tab-ID collision detection before drafts can be loaded or edited.
  getTabId();
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

export function clear(storeName: string): Promise<void> {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, "readwrite");
        tx.objectStore(storeName).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => {
          console.error("[EntityStore] clear failed:", storeName, tx.error);
          reject(tx.error);
        };
      }),
  );
}

export function putBatch(storeName: string, items: any[]): Promise<void> {
  if (items.length === 0) return Promise.resolve();
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, "readwrite");
        const store = tx.objectStore(storeName);
        for (const item of items) {
          store.put(item);
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => {
          console.error("[EntityStore] putBatch failed:", storeName, tx.error);
          reject(tx.error);
        };
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

function draftKey(storeName: string, id: string, tabId = getTabId()): string {
  return `${tabId}:${storeName}:${id}`;
}

function ownsEntityDraft(entity: any): boolean {
  return Boolean(
    entity?._contentDirtyAt &&
    (!entity._contentDirtyOwner || entity._contentDirtyOwner === getTabId()),
  );
}

function getDraft(storeName: string, id: string): Promise<any | null> {
  return get(DRAFT_STORE, draftKey(storeName, id));
}

function putDraft(draft: PendingContentSync): Promise<void> {
  return put(DRAFT_STORE, {
    ...draft,
    key: draftKey(draft.storeName, draft.id, draft.tabId),
  });
}

export async function getRecoveryDrafts(): Promise<RecoveryDraft[]> {
  const drafts = (await getAll(DRAFT_STORE)) as Array<PendingContentSync & { key: string }>;
  return drafts
    .filter((draft): draft is typeof draft & { recoveryState: RecoveryDraft["recoveryState"] } =>
      Boolean(draft.recoveryState),
    )
    .map(({ key, storeName, id, content, dirtyAt, recoveryState, recoveryReason }) => ({
      key,
      storeName,
      id,
      content,
      dirtyAt,
      recoveryState,
      recoveryReason,
    }))
    .sort((a, b) => b.dirtyAt.localeCompare(a.dirtyAt));
}

export async function discardRecoveryDraft(key: string): Promise<void> {
  const draft = (await get(DRAFT_STORE, key)) as (PendingContentSync & { key: string }) | null;
  if (!draft?.recoveryState) return;
  await remove(DRAFT_STORE, key);
  emit("recoveryDraftsChanged");
}

function putEntityAndDraft(
  storeName: string,
  entity: any,
  draft: PendingContentSync,
): Promise<void> {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction([storeName, DRAFT_STORE], "readwrite");
        tx.objectStore(storeName).put(entity);
        tx.objectStore(DRAFT_STORE).put({
          ...draft,
          key: draftKey(draft.storeName, draft.id, draft.tabId),
        });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      }),
  );
}

function persistContentConflict(
  storeName: string,
  id: string,
  conflict: ContentConflictSnapshot,
  expectedMutationId: string,
): Promise<PendingContentSync | null> {
  return withLock(storeName, id, async () => {
    const draft = (await getDraft(storeName, id)) as PendingContentSync | null;
    if (!draft || draft.mutationId !== expectedMutationId) return null;
    const conflictingDraft: PendingContentSync = { ...draft, conflict };
    await putDraft(conflictingDraft);
    _pendingContentSyncs[scopedKey(storeName, id)] = conflictingDraft;
    return conflictingDraft;
  });
}

function preserveRejectedDraft(
  storeName: string,
  id: string,
  pending: PendingContentSync,
  reason: "inactive" | "notFound",
): Promise<boolean> {
  return withLock(storeName, id, () => {
    const key = scopedKey(storeName, id);
    return openDB().then(
      (db) =>
        new Promise<boolean>((resolve, reject) => {
          const tx = db.transaction([storeName, DRAFT_STORE], "readwrite");
          const entityStore = tx.objectStore(storeName);
          const draftStore = tx.objectStore(DRAFT_STORE);
          const draftRequest = draftStore.get(draftKey(storeName, id, pending.tabId));
          let preserved = false;

          draftRequest.onsuccess = () => {
            const draft = draftRequest.result as PendingContentSync | undefined;
            if (!draft || draft.mutationId !== pending.mutationId) return;

            preserved = true;
            draftStore.put({
              ...draft,
              recoveryState: "rejected",
              recoveryReason: reason,
              key: draftKey(storeName, id, pending.tabId),
            });

            const entityRequest = entityStore.get(id);
            entityRequest.onsuccess = () => {
              const entity = entityRequest.result;
              if (
                entity &&
                entity._contentDirtyOwner === pending.tabId &&
                entity._contentDirtyAt === pending.dirtyAt
              ) {
                entity._contentDirtyAt = null;
                entity._contentDirtyOwner = null;
                entity._draftBaseRevision = null;
                entityStore.put(entity);
              }
            };
            entityRequest.onerror = () => reject(entityRequest.error);
          };
          draftRequest.onerror = () => reject(draftRequest.error);
          tx.oncomplete = () => {
            if (preserved && _pendingContentSyncs[key]?.mutationId === pending.mutationId) {
              delete _pendingContentSyncs[key];
            }
            if (preserved && _contentSyncDebounces[key]) {
              clearTimeout(_contentSyncDebounces[key]);
              delete _contentSyncDebounces[key];
            }
            if (preserved) emit("recoveryDraftsChanged");
            resolve(preserved);
          };
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
        }),
    );
  });
}

type DraftCompletion = "completed" | "advanced" | "stale";

function completePendingDraft(
  storeName: string,
  id: string,
  pending: PendingContentSync,
  revision: number,
): Promise<DraftCompletion> {
  return withLock(storeName, id, async () => {
    const key = scopedKey(storeName, id);
    const stored = (await get(
      DRAFT_STORE,
      draftKey(storeName, id, pending.tabId),
    )) as PendingContentSync | null;

    if (!stored || stored.mutationId === pending.mutationId) {
      if (stored) await deleteDraft(storeName, id, pending.tabId);
      if (_pendingContentSyncs[key]?.mutationId === pending.mutationId) {
        delete _pendingContentSyncs[key];
      }
      return "completed";
    }

    if (stored.conflict || stored.recoveryState) return "stale";

    const advanced = { ...stored, baseRevision: revision };
    await putDraft(advanced);
    _pendingContentSyncs[key] = advanced;
    return "advanced";
  });
}

function deleteDraft(storeName: string, id: string, tabId = getTabId()): Promise<void> {
  return remove(DRAFT_STORE, draftKey(storeName, id, tabId));
}

function transferOrphanDraft(
  storeName: string,
  id: string,
  entity: any,
  orphan: PendingContentSync,
  adopted: PendingContentSync,
  conflictingDrafts: PendingContentSync[],
): Promise<void> {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction([storeName, DRAFT_STORE], "readwrite");
        tx.objectStore(storeName).put(entity);

        const draftsStore = tx.objectStore(DRAFT_STORE);
        draftsStore.put({
          ...adopted,
          key: draftKey(storeName, id, adopted.tabId),
        });
        draftsStore.delete(draftKey(storeName, id, orphan.tabId));
        conflictingDrafts.forEach((draft) => {
          draftsStore.put({
            ...draft,
            recoveryState: "conflicting",
            recoveryWinnerMutationId: adopted.mutationId,
            key: draftKey(storeName, id, draft.tabId),
          });
        });

        tx.oncomplete = () => {
          if (conflictingDrafts.length > 0) emit("recoveryDraftsChanged");
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      }),
  );
}

async function adoptOrphanDraft(storeName: string, id: string): Promise<PendingContentSync | null> {
  return withLock(storeName, id, async () => {
    const ownDraft = await getDraft(storeName, id);
    if (ownDraft) return ownDraft as PendingContentSync;

    const candidates = (await getAll(DRAFT_STORE)).filter(
      (draft) => draft.storeName === storeName && draft.id === id && !draft.recoveryState,
    ) as PendingContentSync[];
    const activity = await Promise.all(
      candidates.map(async (draft) => ({ draft, active: await isTabActive(String(draft.tabId)) })),
    );
    const drafts = activity
      .filter(({ active }) => !active)
      .map(({ draft }) => draft)
      .sort((a, b) => String(b.dirtyAt || "").localeCompare(String(a.dirtyAt || "")));
    const orphan = drafts[0] as PendingContentSync | undefined;
    if (!orphan) return null;

    const adopted: PendingContentSync = {
      ...orphan,
      tabId: getTabId(),
      recoveryState: undefined,
      recoveryReason: undefined,
      recoveryWinnerMutationId: undefined,
    };
    const entity = await get(storeName, id);
    if (!entity) return null;

    entity.content = adopted.content;
    entity._contentDirtyAt = adopted.dirtyAt;
    entity._contentDirtyOwner = adopted.tabId;
    entity._draftBaseRevision = adopted.baseRevision;
    await transferOrphanDraft(storeName, id, entity, orphan, adopted, drafts.slice(1));
    logSync("adopted orphan draft", storeName, id, orphan.tabId, "→", adopted.tabId);
    if (drafts.length > 1) {
      console.warn(
        "[EntityStore] Preserved additional orphan drafts as recovery conflicts:",
        storeName,
        id,
        drafts.length - 1,
      );
    }
    return adopted;
  });
}

onTabIdChange((oldTabId) => {
  Object.entries(_pendingContentSyncs).forEach(([key, pending]) => {
    if (pending.tabId !== oldTabId) return;
    delete _pendingContentSyncs[key];
    _contentSyncRequested.delete(key);
    if (_contentSyncDebounces[key]) {
      clearTimeout(_contentSyncDebounces[key]);
      delete _contentSyncDebounces[key];
    }
  });
});

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
    contentRevision: 1,
    _serverContent: "",
    _dirty: true,
    _pendingCreate: true,
    ...entityData,
  };
  rememberEntityStore(storeName, item.id);
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
  rememberEntityStore(storeName, id);
  return withLock(storeName, id, () =>
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
  rememberEntityStore(storeName, id);
  return withLock(storeName, id, () =>
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
      rememberEntityStore(storeName, e.id);
      return withLock(storeName, e.id, () =>
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
  rememberEntityStore(storeName, id);
  return withLock(storeName, id, () =>
    get(storeName, id).then((item) => {
      if (!item) return;
      item.isActive = false;
      item._dirty = true;
      return put(storeName, item);
    }),
  );
}

export function archiveEntity(storeName: string, id: string): Promise<void> {
  rememberEntityStore(storeName, id);
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
  opts?: ContentSaveOptions,
): Promise<void> {
  const key = rememberEntityStore(storeName, id);
  if (isDev() && (window as any).__mockLocalSaveShouldFailOnce) {
    (window as any).__mockLocalSaveShouldFailOnce = false;
    return Promise.reject(new Error("Mock: forced local save error"));
  }
  return withLock(storeName, id, async () => {
    const existing = await get(storeName, id);
    if (!existing) return;
    logSync("saveContent → IDB", storeName, id, `${content.length} chars`);
    if (!content && !existing._serverUpdatedAt && !existing._pendingCreate) {
      console.warn("[EntityStore] Skipping empty content save for unconfirmed entity:", id);
      return;
    }
    const now = new Date().toISOString();
    const tabId = getTabId();
    const baseRevision = Number(opts?.baseRevision ?? existing.contentRevision ?? 0);
    const pending: PendingContentSync = {
      storeName,
      id,
      tabId,
      content,
      baseRevision,
      mutationId: opts?.mutationId || crypto.randomUUID(),
      dirtyAt: now,
    };
    existing.content = content;
    existing._contentDirtyAt = now;
    existing._contentDirtyOwner = tabId;
    existing._draftBaseRevision = baseRevision;
    await putEntityAndDraft(storeName, existing, pending);
    _pendingContentSyncs[key] = pending;
    if (opts?.immediateSync) {
      if (_contentSyncDebounces[key]) {
        clearTimeout(_contentSyncDebounces[key]);
        delete _contentSyncDebounces[key];
      }
      void syncContentToServer(storeName, id);
    } else {
      scheduleContentSync(storeName, id);
    }
  });
}

export function getContent(storeName: string, id: string): Promise<string | null> {
  return getContentSnapshot(storeName, id).then((snapshot) => snapshot?.content ?? null);
}

export async function getContentSnapshot(
  storeName: string,
  id: string,
): Promise<ContentSnapshot | null> {
  if (isDev() && (window as any).__mockLocalLoadShouldFailOnce) {
    (window as any).__mockLocalLoadShouldFailOnce = false;
    throw new Error("Mock: forced local load error");
  }
  const [record, ownDraft] = await Promise.all([get(storeName, id), getDraft(storeName, id)]);
  if (!record) return null;
  const draft = ownDraft || (await adoptOrphanDraft(storeName, id));
  if (draft) {
    return {
      content: String(draft.content || ""),
      revision: Math.max(0, Number(draft.baseRevision) || 0),
      dirty: true,
      conflict: draft.conflict,
    };
  }

  // Legacy dirty records predate the per-tab draft store. Preserve them on the
  // tab that owns them (or when no owner was recorded).
  if (ownsEntityDraft(record)) {
    return {
      content: String(record.content || ""),
      revision: Math.max(0, Number(record._draftBaseRevision ?? record.contentRevision ?? 0) || 0),
      dirty: true,
    };
  }

  return {
    content: String(record._serverContent ?? record.content ?? ""),
    revision: Math.max(0, Number(record.contentRevision) || 0),
    dirty: false,
  };
}

export async function getCommittedContentSnapshot(
  storeName: string,
  id: string,
): Promise<ContentSnapshot | null> {
  const record = await get(storeName, id);
  if (!record) return null;
  return {
    content: String(record._serverContent ?? record.content ?? ""),
    revision: Math.max(0, Number(record.contentRevision) || 0),
    dirty: false,
  };
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
        withLock(storeName, id, () =>
          get(storeName, id).then((latest) => {
            if (!latest) return;
            latest._pendingCreate = false;
            latest._serverUpdatedAt = result.updatedAt;
            if (latest.updatedAt === capturedUpdatedAt) {
              latest._dirty = false;
            }
            return put(storeName, latest);
          }),
        ).then(() => {
          syncMetadataToServer(storeName, id);
          return syncContentToServer(storeName, id);
        }),
      );
    })
    .catch((err) => {
      console.error("[EntityStore] syncCreateToServer failed:", storeName, id, err);
    });
}

function scheduleMetadataSync(storeName: string, id: string): void {
  const key = rememberEntityStore(storeName, id);
  if (_metaDebounces[key]) clearTimeout(_metaDebounces[key]);
  _metaDebounces[key] = setTimeout(() => {
    delete _metaDebounces[key];
    syncMetadataToServer(storeName, id);
  }, 1000);
}

function syncMetadataToServer(storeName: string, id: string): void {
  get(storeName, id)
    .then((entity) => {
      if (!entity) return;
      if (entity._pendingCreate) return;
      if (!entity._dirty) return;
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
          return withLock(storeName, id, () =>
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
        withLock(storeName, id, () =>
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
  const key = rememberEntityStore(storeName, id);
  if (_contentSyncDebounces[key]) clearTimeout(_contentSyncDebounces[key]);
  _contentSyncDebounces[key] = setTimeout(() => {
    delete _contentSyncDebounces[key];
    syncContentToServer(storeName, id);
  }, 30000);
}

export function flushContentSync(storeName: string, id: string): void {
  const key = rememberEntityStore(storeName, id);
  if (_contentSyncDebounces[key]) {
    clearTimeout(_contentSyncDebounces[key]);
    delete _contentSyncDebounces[key];
  }
  syncContentToServer(storeName, id);
}

async function syncContentToServer(storeName: string, id: string): Promise<void> {
  const key = scopedKey(storeName, id);
  if (_contentSyncInFlight.has(key)) {
    _contentSyncRequested.add(key);
    return;
  }
  let continueWithNewerPending = false;
  try {
    const entity = await get(storeName, id);
    if (!entity || entity._pendingCreate) return;

    let pending = _pendingContentSyncs[key];
    if (!pending) {
      const draft = await getDraft(storeName, id);
      if (draft) {
        pending = draft as PendingContentSync;
        _pendingContentSyncs[key] = pending;
      } else if (ownsEntityDraft(entity)) {
        pending = {
          storeName,
          id,
          tabId: getTabId(),
          content: String(entity.content || ""),
          baseRevision: Math.max(
            1,
            Number(entity._draftBaseRevision || entity.contentRevision) || 1,
          ),
          mutationId: crypto.randomUUID(),
          dirtyAt: entity._contentDirtyAt,
        };
        _pendingContentSyncs[key] = pending;
        await putDraft(pending);
      }
    }
    if (!pending || pending.conflict || pending.recoveryState) return;

    _contentSyncInFlight.add(key);

    const cfg = _registrations[storeName];
    if (!cfg?.contentSyncFn) return;
    logSync(
      "content → server",
      storeName,
      id,
      `${pending.content.length} chars`,
      `rev ${pending.baseRevision}`,
    );

    const result: any = await retryWithBackoff(() =>
      cfg.contentSyncFn!(id, pending!.content, pending!.baseRevision, pending!.mutationId),
    );

    // A duplicated tab may rotate its ID while this request is in flight. The
    // old-ID draft belongs to the tab that retained that ID, so never settle it
    // from the rotated tab.
    if (pending.tabId !== getTabId()) return;

    if (result?.status === "conflict") {
      if (!_pendingContentSyncs[key]) return;
      const applied = await applyCommittedSnapshot(
        storeName,
        id,
        String(result.content || ""),
        Math.max(1, Number(result.revision) || 1),
        String(result.updatedAt || ""),
        { preserveDraft: true },
      );
      if (!applied) return;
      const conflict = {
        content: applied.snapshot.content,
        revision: applied.snapshot.revision,
        updatedAt: applied.snapshot.updatedAt,
      };
      const conflictingPending = await persistContentConflict(
        storeName,
        id,
        conflict,
        pending.mutationId,
      );
      if (!conflictingPending) {
        continueWithNewerPending = Boolean(_pendingContentSyncs[key]);
        return;
      }
      emit("contentConflict", {
        storeName,
        id,
        ...conflict,
        mutationId: conflictingPending.mutationId,
      });
      return;
    }

    if (result?.status === "inactive" || result?.status === "notFound") {
      const preserved = await preserveRejectedDraft(storeName, id, pending, result.status);
      continueWithNewerPending = !preserved && Boolean(_pendingContentSyncs[key]);
      throw new Error(`Content save rejected: ${result.status}`);
    }

    const revision = Number(result?.revision);
    if (result?.status !== "saved" || !Number.isFinite(revision) || revision < 1) {
      throw new Error(`Invalid content save response: ${String(result?.status || "missing")}`);
    }
    const updatedAt = String(result.updatedAt || "");
    const applied = await applyCommittedSnapshot(
      storeName,
      id,
      pending.content,
      revision,
      updatedAt,
      {
        pending,
      },
    );
    if (!applied) return;

    if (!applied.applied && applied.snapshot.revision > revision) {
      const latestPending = _pendingContentSyncs[key];
      if (latestPending?.content === applied.snapshot.content) {
        await acceptCommittedContent(
          storeName,
          id,
          applied.snapshot.content,
          applied.snapshot.revision,
          applied.snapshot.updatedAt,
        );
        emit("contentCommitted", {
          storeName,
          id,
          content: applied.snapshot.content,
          revision: applied.snapshot.revision,
          updatedAt: applied.snapshot.updatedAt,
          mutationId: latestPending.mutationId,
        });
      } else if (latestPending) {
        const conflict = {
          content: applied.snapshot.content,
          revision: applied.snapshot.revision,
          updatedAt: applied.snapshot.updatedAt,
        };
        const conflictingPending = await persistContentConflict(
          storeName,
          id,
          conflict,
          latestPending.mutationId,
        );
        if (!conflictingPending) return;
        emit("contentConflict", {
          storeName,
          id,
          ...conflict,
          mutationId: conflictingPending.mutationId,
        });
      }
      return;
    }
    const completion = await completePendingDraft(storeName, id, pending, revision);
    continueWithNewerPending = completion === "advanced";

    const event = {
      storeName,
      id,
      content: pending.content,
      revision,
      updatedAt,
      mutationId: pending.mutationId,
    };
    emit("contentCommitted", event);
    publishDocumentCommit({ storeName, id, revision, updatedAt });
  } catch (err) {
    console.error("[EntityStore] syncContentToServer failed:", storeName, id, err);
    emit("contentSyncError", { storeName, id, error: err });
  } finally {
    _contentSyncInFlight.delete(key);
    if (continueWithNewerPending || _contentSyncRequested.delete(key)) {
      void syncContentToServer(storeName, id);
    }
  }
}

async function applyCommittedSnapshot(
  storeName: string,
  id: string,
  content: string,
  revision: number,
  updatedAt: string,
  opts?: { preserveDraft?: boolean; pending?: PendingContentSync; accept?: boolean },
): Promise<AppliedCommittedSnapshot | null> {
  return withLock(storeName, id, () =>
    openDB().then(
      (db) =>
        new Promise((resolve, reject) => {
          const tx = db.transaction(storeName, "readwrite");
          const store = tx.objectStore(storeName);
          const req = store.get(id);
          let result: AppliedCommittedSnapshot | null = null;

          req.onsuccess = () => {
            const latest = req.result;
            if (!latest) return;
            const currentRevision = Math.max(1, Number(latest.contentRevision) || 1);
            if (revision < currentRevision) {
              const currentContent = String(latest._serverContent ?? latest.content ?? "");
              if (opts?.accept) {
                latest.content = currentContent;
                latest._contentDirtyAt = null;
                latest._contentDirtyOwner = null;
                latest._draftBaseRevision = null;
                store.put(latest);
              }
              result = {
                applied: false,
                snapshot: {
                  content: currentContent,
                  revision: currentRevision,
                  updatedAt: String(latest._serverUpdatedAt || ""),
                  dirty: false,
                },
              };
              return;
            }

            latest._serverContent = content;
            latest.contentRevision = revision;
            latest._serverUpdatedAt = updatedAt || latest._serverUpdatedAt;

            const pending = opts?.pending;
            if (
              opts?.accept ||
              (!opts?.preserveDraft &&
                pending &&
                latest._contentDirtyOwner === pending.tabId &&
                latest.content === pending.content &&
                latest._contentDirtyAt === pending.dirtyAt)
            ) {
              latest.content = content;
              latest._contentDirtyAt = null;
              latest._contentDirtyOwner = null;
              latest._draftBaseRevision = null;
            }
            store.put(latest);
            result = {
              applied: true,
              snapshot: {
                content,
                revision,
                updatedAt: String(updatedAt || latest._serverUpdatedAt || ""),
                dirty: false,
              },
            };
          };
          req.onerror = () => reject(req.error);
          tx.oncomplete = () => resolve(result);
          tx.onerror = () => reject(tx.error);
        }),
    ),
  );
}

async function applyAcceptedSnapshot(
  storeName: string,
  id: string,
  content: string,
  revision: number,
  updatedAt: string,
): Promise<CommittedSnapshot | null> {
  const applied = await applyCommittedSnapshot(storeName, id, content, revision, updatedAt, {
    accept: true,
  });
  return applied?.snapshot ?? null;
}

export async function acceptCommittedContent(
  storeName: string,
  id: string,
  content: string,
  revision: number,
  updatedAt = "",
): Promise<ContentSnapshot | null> {
  const key = scopedKey(storeName, id);
  if (_contentSyncDebounces[key]) {
    clearTimeout(_contentSyncDebounces[key]);
    delete _contentSyncDebounces[key];
  }
  delete _pendingContentSyncs[key];
  const snapshot = await applyAcceptedSnapshot(storeName, id, content, revision, updatedAt);
  if (snapshot) await deleteDraft(storeName, id);
  return snapshot;
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
    Object.keys(_pendingContentSyncs).length > 0 ||
    _contentSyncInFlight.size > 0 ||
    Object.values(_reorderState).some((s) => s.pending !== null)
  );
}

export function flushAllSyncs(): void {
  logSync("flushAll");
  Object.keys(_metaDebounces).forEach((key) => {
    clearTimeout(_metaDebounces[key]);
    delete _metaDebounces[key];
    const entry = _entityStoreMap[key];
    if (entry) syncMetadataToServer(entry.storeName, entry.id);
  });
  Object.keys(_contentSyncDebounces).forEach((key) => {
    clearTimeout(_contentSyncDebounces[key]);
    delete _contentSyncDebounces[key];
    const entry = _entityStoreMap[key];
    if (entry) syncContentToServer(entry.storeName, entry.id);
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
        const pendingKey = scopedKey(storeName, se.id);
        const pending = _pendingServerContent[pendingKey];
        if (pending) {
          se.content = pending.content;
          se.contentRevision = pending.revision;
          delete _pendingServerContent[pendingKey];
        } else {
          se.content = "";
          // Metadata does not contain the matching body snapshot. Revision 0
          // forces CAS conflict detection if content loading fails before edit.
          se.contentRevision = 0;
        }
        ops.push(put(storeName, se));
      }
    });

    // 2. Local only
    localEntities.forEach((le) => {
      if (!serverMap[le.id]) {
        if (!le._serverUpdatedAt) {
          ops.push(
            withLock(storeName, le.id, () =>
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
      rememberEntityStore(storeName, se.id);
      if (!le._dirty) {
        const merged: any = { ...se };
        Object.keys(le).forEach((k) => {
          if (k.charAt(0) === "_" || k === "content") {
            if (k.startsWith("_cached")) return; // サーバー値を優先
            merged[k] = le[k];
          }
        });
        // `content` and its revision must always describe the same committed
        // snapshot. Server metadata may already advertise a newer revision.
        merged.contentRevision = le.contentRevision ?? 0;
        merged._serverUpdatedAt = se.updatedAt;
        merged._dirty = false;
        ops.push(put(storeName, merged));
      } else {
        ops.push(
          withLock(storeName, se.id, () =>
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
        rememberEntityStore(storeName, entity.id);
        if (entity._pendingCreate) {
          syncCreateToServer(storeName, entity.id);
        } else if (entity._dirty) {
          scheduleMetadataSync(storeName, entity.id);
        }
        if (ownsEntityDraft(entity)) {
          scheduleContentSync(storeName, entity.id);
        }
      });
    })
    .catch((err) => {
      console.warn("[EntityStore] requeueDirtyRecords error:", storeName, err);
    });

  getAll(DRAFT_STORE)
    .then(async (drafts) => {
      const candidates = drafts.filter(
        (draft) => draft.storeName === storeName && !draft.recoveryState && !draft.conflict,
      );
      const activity = await Promise.all(
        candidates.map(async (draft) => ({
          draft,
          active: await isTabActive(String(draft.tabId)),
        })),
      );
      const ids = new Set(
        activity
          .filter(({ draft, active }) => draft.tabId === getTabId() || !active)
          .map(({ draft }) => String(draft.id)),
      );
      ids.forEach((id) => {
        void adoptOrphanDraft(storeName, id).then((draft) => {
          if (!draft) return;
          const key = rememberEntityStore(storeName, id);
          _pendingContentSyncs[key] = draft;
          scheduleContentSync(storeName, id);
        });
      });
    })
    .catch((err) => {
      console.warn("[EntityStore] requeue drafts error:", storeName, err);
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
  revision: number,
): Promise<CommittedSnapshot | null> {
  return applyAcceptedSnapshot(storeName, id, content, revision, serverTs);
}

function resolveContentConflict(
  storeName: string,
  id: string,
  serverResult: any,
): Promise<{ useServer: boolean; content?: string; revision?: number } | null> {
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
  const serverRevision = Math.max(1, Number(serverResult.contentRevision) || 1);

  return Promise.all([get(storeName, id), getDraft(storeName, id)]).then(([entity, ownDraft]) => {
    if (!entity) {
      if (!serverContent) return { useServer: false };
      _pendingServerContent[scopedKey(storeName, id)] = {
        content: serverContent,
        serverTs,
        revision: serverRevision,
      };
      // エンティティ未存在時も contentResolved を発火
      const cfg = _registrations[storeName];
      emit("contentResolved", {
        storeName,
        entityType: cfg?.entityType || storeName,
        id,
        content: serverContent,
        revision: serverRevision,
      });
      return { useServer: true, content: serverContent, revision: serverRevision };
    }

    const ownsStoredDraft = ownsEntityDraft(entity);
    const hasOwnDirtyContent = Boolean(ownDraft || ownsStoredDraft);
    const localContent = ownDraft?.content ?? entity.content ?? "";

    if (hasOwnDirtyContent && localContent === serverContent) {
      return acceptCommittedContent(storeName, id, localContent, serverRevision, serverTs).then(
        (snapshot) => ({
          useServer: false,
          revision: snapshot?.revision ?? serverRevision,
        }),
      );
    }

    if (hasOwnDirtyContent) {
      logSync("resolve: local dirty, keep local", storeName, id);
      return applyCommittedSnapshot(storeName, id, serverContent, serverRevision, serverTs, {
        preserveDraft: true,
      }).then((applied) => {
        if (!ownDraft?.recoveryState) scheduleContentSync(storeName, id);
        return {
          useServer: false,
          revision: applied?.snapshot.revision ?? serverRevision,
        };
      });
    }

    // Another tab may own the shared record's compatibility dirty fields.
    // Update only the committed snapshot so that tab's draft is not cleared.
    if (entity._contentDirtyAt) {
      return applyCommittedSnapshot(storeName, id, serverContent, serverRevision, serverTs, {
        preserveDraft: true,
      }).then((applied) => {
        const snapshot = applied?.snapshot;
        if (!snapshot) return { useServer: false, revision: serverRevision };
        const cfg = _registrations[storeName];
        emit("contentResolved", {
          storeName,
          entityType: cfg?.entityType || storeName,
          id,
          content: snapshot.content,
          revision: snapshot.revision,
        });
        return { useServer: true, content: snapshot.content, revision: snapshot.revision };
      });
    }

    const committedContent = entity._serverContent ?? entity.content ?? "";
    if (committedContent === serverContent) {
      return applyServerContent(storeName, id, serverContent, serverTs, serverRevision).then(
        (snapshot) => ({
          useServer: false,
          revision: snapshot?.revision ?? serverRevision,
        }),
      );
    }

    logSync("resolve: use server content", storeName, id, `${serverContent.length} chars`);
    return applyServerContent(storeName, id, serverContent, serverTs, serverRevision).then(
      (snapshot) => {
        if (!snapshot) return { useServer: false, revision: serverRevision };
        const cfg = _registrations[storeName];
        emit("contentResolved", {
          storeName,
          entityType: cfg?.entityType || storeName,
          id,
          content: snapshot.content,
          revision: snapshot.revision,
        });
        return { useServer: true, content: snapshot.content, revision: snapshot.revision };
      },
    );
  });
}

export function resolveWithServer(
  storeName: string,
  id: string,
): Promise<{ useServer: boolean; content?: string; revision?: number } | null> {
  const cfg = _registrations[storeName];
  if (!cfg?.serverFns?.getContent) {
    return Promise.resolve(null);
  }
  logSync("resolve ← server", storeName, id);
  function attempt(): Promise<{ useServer: boolean; content?: string; revision?: number } | null> {
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
