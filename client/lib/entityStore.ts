/**
 * Metadata store and synchronization.
 *
 * Document bodies and drafts intentionally live in documentRepository. Keeping
 * this module metadata-only prevents body revision and dirty state from being
 * duplicated across entity records and the document stores.
 */

import { serverCall } from "./serverCall";

let debugSync = false;

export function setDebugSync(enabled: boolean): void {
  debugSync = enabled;
}

function logSync(tag: string, ...args: unknown[]): void {
  if (debugSync) console.log(`[EntityStore] ${tag}`, ...args);
}

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
    reorder?: string;
  };
  addServerArgs?: (entity: any) => unknown[];
  onUpdateHook?: (item: any, fields: Record<string, any>) => void;
}

export interface DataChangedEvent {
  entityType: string;
  op: string;
  id?: string;
}

type EventCallback = (data: any) => void;

let dbConnection: IDBDatabase | null = null;
let dbName: string | null = null;
let dbVersion: number | null = null;
let onUpgrade: ((db: IDBDatabase, oldVersion: number, newVersion: number | null) => void) | null =
  null;

const listeners: Record<string, EventCallback[]> = {};
const registrations: Record<string, StoreRegistration> = {};
const entityStoreMap: Record<string, { storeName: string; id: string }> = {};
const metadataDebounces: Record<string, ReturnType<typeof setTimeout>> = {};
const reorderState: Record<string, { pending: unknown[] | null; saving: boolean }> = {};
const reorderDebounces: Record<string, ReturnType<typeof setTimeout>> = {};
const pendingOperations: Record<string, Promise<any>> = {};

function scopedKey(storeName: string, id: string): string {
  return `${storeName}:${id}`;
}

function rememberEntity(storeName: string, id: string): string {
  const key = scopedKey(storeName, id);
  entityStoreMap[key] = { storeName, id };
  return key;
}

export function withLock<T>(
  storeName: string,
  id: string,
  operation: () => Promise<T>,
): Promise<T> {
  const key = scopedKey(storeName, id);
  const previous = pendingOperations[key] || Promise.resolve();
  const run = async (): Promise<T> => {
    if (navigator.locks) {
      return await navigator.locks.request(`gas-pomodoro:${storeName}:${id}`, operation);
    }
    return await operation();
  };
  const next = previous.then(run, run);
  pendingOperations[key] = next;
  const cleanup = () => {
    if (pendingOperations[key] === next) delete pendingOperations[key];
  };
  next.then(cleanup, cleanup);
  return next;
}

export function register(storeName: string, config: StoreRegistration): void {
  registrations[storeName] = { ...config, storeName };
  reorderState[storeName] = { pending: null, saving: false };
}

export function init(
  name: string,
  version: number,
  options?: {
    onUpgrade?: (db: IDBDatabase, oldVersion: number, newVersion: number | null) => void;
  },
): Promise<void> {
  dbName = name;
  dbVersion = version;
  onUpgrade = options?.onUpgrade ?? null;
  return openDatabase().then(() => {
    window.addEventListener("beforeunload", (event) => {
      const pending = hasPendingChanges();
      flushAllSyncs();
      if (pending) {
        event.preventDefault();
        event.returnValue = "";
      }
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flushAllSyncs();
    });
  });
}

function openDatabase(): Promise<IDBDatabase> {
  if (dbConnection) return Promise.resolve(dbConnection);
  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(dbName!, dbVersion!);
    } catch (error) {
      reject(error);
      return;
    }
    request.onupgradeneeded = (event) => {
      const db = request.result;
      Object.entries(registrations).forEach(([storeName, config]) => {
        if (db.objectStoreNames.contains(storeName)) return;
        const store = db.createObjectStore(storeName, { keyPath: config.keyPath || "id" });
        (config.indexes || []).forEach((index) => {
          store.createIndex(index.name, index.keyPath, index.options || { unique: false });
        });
      });
      onUpgrade?.(
        db,
        (event as IDBVersionChangeEvent).oldVersion,
        (event as IDBVersionChangeEvent).newVersion,
      );
    };
    request.onsuccess = () => {
      dbConnection = request.result;
      dbConnection.onversionchange = () => {
        dbConnection?.close();
        dbConnection = null;
      };
      resolve(dbConnection);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => {
      console.warn("[EntityStore] IndexedDB upgrade is blocked by another page");
    };
  });
}

export function getDatabase(): Promise<IDBDatabase> {
  return openDatabase();
}

export function getAll(storeName: string): Promise<any[]> {
  return openDatabase().then(
    (db) =>
      new Promise((resolve, reject) => {
        const request = db.transaction(storeName, "readonly").objectStore(storeName).getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      }),
  );
}

export function get(storeName: string, id: string): Promise<any | null> {
  return openDatabase().then(
    (db) =>
      new Promise((resolve, reject) => {
        const request = db.transaction(storeName, "readonly").objectStore(storeName).get(id);
        request.onsuccess = () => resolve(request.result ?? null);
        request.onerror = () => reject(request.error);
      }),
  );
}

export function put(storeName: string, data: any): Promise<void> {
  return openDatabase().then(
    (db) =>
      new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, "readwrite");
        transaction.objectStore(storeName).put(data);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      }),
  );
}

export function remove(storeName: string, id: string): Promise<void> {
  return openDatabase().then(
    (db) =>
      new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, "readwrite");
        transaction.objectStore(storeName).delete(id);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      }),
  );
}

export function clear(storeName: string): Promise<void> {
  return openDatabase().then(
    (db) =>
      new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, "readwrite");
        transaction.objectStore(storeName).clear();
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      }),
  );
}

export function putBatch(storeName: string, items: any[]): Promise<void> {
  if (items.length === 0) return Promise.resolve();
  return openDatabase().then(
    (db) =>
      new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, "readwrite");
        const store = transaction.objectStore(storeName);
        items.forEach((item) => store.put(item));
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      }),
  );
}

export function getByIndex(storeName: string, indexName: string, value: string): Promise<any[]> {
  return openDatabase().then(
    (db) =>
      new Promise((resolve, reject) => {
        const request = db
          .transaction(storeName, "readonly")
          .objectStore(storeName)
          .index(indexName)
          .getAll(value);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      }),
  );
}

export function on(event: string, callback: EventCallback): void {
  if (!listeners[event]) listeners[event] = [];
  listeners[event].push(callback);
}

export function off(event: string, callback: EventCallback): void {
  const callbacks = listeners[event];
  if (!callbacks) return;
  const index = callbacks.indexOf(callback);
  if (index >= 0) callbacks.splice(index, 1);
}

export function emit(event: string, data?: any): void {
  (listeners[event] || []).slice().forEach((callback) => {
    try {
      callback(data);
    } catch (error) {
      console.error(`[EntityStore] listener failed for ${event}:`, error);
    }
  });
}

export function addEntity(storeName: string, entityData: Record<string, any>): Promise<string> {
  const now = new Date().toISOString();
  const item: any = {
    sortOrder: Date.now(),
    isActive: true,
    createdAt: now,
    updatedAt: now,
    contentRevision: 1,
    _dirty: true,
    _pendingCreate: true,
    ...entityData,
  };
  rememberEntity(storeName, item.id);
  return put(storeName, item).then(() => {
    const config = registrations[storeName];
    emit("dataChanged", { entityType: config?.entityType || storeName, op: "add", id: item.id });
    syncCreateToServer(storeName, item.id);
    return item.id;
  });
}

export function updateEntityFields(
  storeName: string,
  id: string,
  fields: Record<string, any>,
): Promise<void> {
  rememberEntity(storeName, id);
  return withLock(storeName, id, async () => {
    const item = await get(storeName, id);
    if (!item) return;
    const config = registrations[storeName];
    config?.onUpdateHook?.(item, fields);
    Object.assign(item, fields, { updatedAt: new Date().toISOString(), _dirty: true });
    await put(storeName, item);
    emit("dataChanged", { entityType: config?.entityType || storeName, op: "update", id });
    scheduleMetadataSync(storeName, id);
  });
}

export function updateEntityRaw(
  storeName: string,
  id: string,
  merge: (item: any) => void,
): Promise<void> {
  rememberEntity(storeName, id);
  return withLock(storeName, id, async () => {
    const item = await get(storeName, id);
    if (!item) return;
    merge(item);
    await put(storeName, item);
  });
}

export function updateSortOrders(
  storeName: string,
  entries: Array<{ id: string; sortOrder: number }>,
): Promise<void> {
  return Promise.all(
    entries.map(({ id, sortOrder }) => {
      rememberEntity(storeName, id);
      return withLock(storeName, id, async () => {
        const item = await get(storeName, id);
        if (!item) return;
        item.sortOrder = sortOrder;
        item._dirty = true;
        await put(storeName, item);
      }).catch((error) => {
        console.error("[EntityStore] updateSortOrders failed:", id, error);
      });
    }),
  ).then(() => undefined);
}

export function setInactive(storeName: string, id: string): Promise<void> {
  rememberEntity(storeName, id);
  return withLock(storeName, id, async () => {
    const item = await get(storeName, id);
    if (!item) return;
    item.isActive = false;
    item._dirty = true;
    await put(storeName, item);
  });
}

export function archiveEntity(storeName: string, id: string): Promise<void> {
  return setInactive(storeName, id).then(() => {
    const config = registrations[storeName];
    emit("dataChanged", { entityType: config?.entityType || storeName, op: "archive", id });
    syncArchiveToServer(storeName, id);
  });
}

function stripLocalFields(entity: Record<string, any>): Record<string, any> {
  return Object.fromEntries(Object.entries(entity).filter(([key]) => !key.startsWith("_")));
}

function retryWithBackoff(operation: () => Promise<any>, maxRetries = 5): Promise<any> {
  const attempt = (retry: number): Promise<any> =>
    operation().catch((error) => {
      if (retry >= maxRetries) {
        emit("syncError", { error });
        throw error;
      }
      return new Promise((resolve) => setTimeout(resolve, 2 ** retry * 1000)).then(() =>
        attempt(retry + 1),
      );
    });
  return attempt(0);
}

function syncCreateToServer(storeName: string, id: string): void {
  void get(storeName, id)
    .then((entity) => {
      if (!entity?._pendingCreate) return;
      const config = registrations[storeName];
      if (!config?.serverFns?.add || !config.addServerArgs) return;
      const capturedUpdatedAt = entity.updatedAt;
      return retryWithBackoff(() =>
        serverCall(config.serverFns!.add!, ...config.addServerArgs!(entity)),
      ).then((result: any) =>
        withLock(storeName, id, async () => {
          const latest = await get(storeName, id);
          if (!latest) return;
          latest._pendingCreate = false;
          latest._serverUpdatedAt = result?.updatedAt;
          if (latest.updatedAt === capturedUpdatedAt) latest._dirty = false;
          await put(storeName, latest);
          syncMetadataToServer(storeName, id);
        }),
      );
    })
    .catch((error) => {
      console.error("[EntityStore] create sync failed:", storeName, id, error);
    });
}

function scheduleMetadataSync(storeName: string, id: string): void {
  const key = rememberEntity(storeName, id);
  if (metadataDebounces[key]) clearTimeout(metadataDebounces[key]);
  metadataDebounces[key] = setTimeout(() => {
    delete metadataDebounces[key];
    syncMetadataToServer(storeName, id);
  }, 1000);
}

function syncMetadataToServer(storeName: string, id: string): void {
  void get(storeName, id)
    .then((entity) => {
      if (!entity || entity._pendingCreate || !entity._dirty) return;
      const config = registrations[storeName];
      if (!config?.serverFns?.update) return;
      const capturedUpdatedAt = entity.updatedAt;
      const clean = stripLocalFields(entity);
      delete clean.id;
      delete clean.createdAt;
      delete clean.content;
      delete clean.contentRevision;
      return retryWithBackoff(() => serverCall(config.serverFns!.update!, id, clean)).then(
        (result: any) => {
          if (!result?.updatedAt) return;
          return withLock(storeName, id, async () => {
            const latest = await get(storeName, id);
            if (!latest) return;
            latest._serverUpdatedAt = result.updatedAt;
            if (latest.updatedAt === capturedUpdatedAt) latest._dirty = false;
            await put(storeName, latest);
          });
        },
      );
    })
    .catch((error) => {
      console.error("[EntityStore] metadata sync failed:", storeName, id, error);
    });
}

export function syncArchiveToServer(storeName: string, id: string): void {
  void get(storeName, id)
    .then((entity) => {
      if (!entity || entity._pendingCreate) return;
      const config = registrations[storeName];
      if (!config?.serverFns?.archive) return;
      return retryWithBackoff(() => serverCall(config.serverFns!.archive!, id)).then(() =>
        withLock(storeName, id, async () => {
          const latest = await get(storeName, id);
          if (!latest) return;
          latest._dirty = false;
          await put(storeName, latest);
        }),
      );
    })
    .catch((error) => {
      console.error("[EntityStore] archive sync failed:", storeName, id, error);
    });
}

export function scheduleReorderSync(storeName: string, args: unknown[]): void {
  const state = reorderState[storeName];
  if (!state) return;
  state.pending = args;
  if (reorderDebounces[storeName]) clearTimeout(reorderDebounces[storeName]);
  reorderDebounces[storeName] = setTimeout(() => {
    delete reorderDebounces[storeName];
    flushReorderSync(storeName);
  }, 5000);
}

function flushReorderSync(storeName: string): void {
  const state = reorderState[storeName];
  if (!state || state.saving || !state.pending) return;
  const args = state.pending;
  state.pending = null;
  state.saving = true;
  const reorderFunction = registrations[storeName]?.serverFns?.reorder;
  if (!reorderFunction) {
    state.saving = false;
    return;
  }
  void serverCall(reorderFunction, ...args)
    .catch((error) => console.error("[EntityStore] reorder sync failed:", storeName, error))
    .finally(() => {
      state.saving = false;
      if (state.pending) flushReorderSync(storeName);
    });
}

export function hasPendingChanges(): boolean {
  return (
    Object.keys(metadataDebounces).length > 0 ||
    Object.values(reorderState).some((state) => state.pending !== null)
  );
}

export function flushAllSyncs(): void {
  Object.entries(metadataDebounces).forEach(([key, timer]) => {
    clearTimeout(timer);
    delete metadataDebounces[key];
    const entity = entityStoreMap[key];
    if (entity) syncMetadataToServer(entity.storeName, entity.id);
  });
  Object.keys(reorderState).forEach((storeName) => {
    const timer = reorderDebounces[storeName];
    if (timer) {
      clearTimeout(timer);
      delete reorderDebounces[storeName];
    }
    flushReorderSync(storeName);
  });
}

export async function mergeServerData(storeName: string, serverEntities: any[]): Promise<void> {
  const localEntities = await getAll(storeName);
  const localById = new Map(localEntities.map((entity) => [entity.id, entity]));
  const serverById = new Map(serverEntities.map((entity) => [entity.id, entity]));
  const operations: Promise<unknown>[] = [];

  serverEntities.forEach((serverEntity) => {
    const local = localById.get(serverEntity.id);
    if (!local) {
      operations.push(
        put(storeName, {
          ...serverEntity,
          _serverUpdatedAt: serverEntity.updatedAt,
          _dirty: false,
        }),
      );
      return;
    }

    rememberEntity(storeName, serverEntity.id);
    if (local._dirty) {
      operations.push(
        withLock(storeName, serverEntity.id, async () => {
          const latest = await get(storeName, serverEntity.id);
          if (!latest) return;
          latest._serverUpdatedAt = serverEntity.updatedAt;
          await put(storeName, latest);
        }),
      );
      scheduleMetadataSync(storeName, serverEntity.id);
      return;
    }

    const privateFields = Object.fromEntries(
      Object.entries(local).filter(([key]) => key.startsWith("_") && !key.startsWith("_cached")),
    );
    const legacyBodyFields =
      local.content !== undefined || local._serverContent !== undefined
        ? {
            content: local.content,
            _serverContent: local._serverContent,
            _contentDirtyAt: local._contentDirtyAt,
            _contentDirtyOwner: local._contentDirtyOwner,
            _draftBaseRevision: local._draftBaseRevision,
            contentRevision: local.contentRevision,
          }
        : {};
    operations.push(
      put(storeName, {
        ...serverEntity,
        ...privateFields,
        ...legacyBodyFields,
        _serverUpdatedAt: serverEntity.updatedAt,
        _dirty: false,
      }),
    );
  });

  localEntities.forEach((local) => {
    if (serverById.has(local.id)) return;
    if (!local._serverUpdatedAt) {
      operations.push(
        withLock(storeName, local.id, async () => {
          const latest = await get(storeName, local.id);
          if (!latest) return;
          latest._pendingCreate = true;
          latest._dirty = true;
          await put(storeName, latest);
          syncCreateToServer(storeName, local.id);
        }),
      );
      return;
    }
    operations.push(
      withLock(storeName, local.id, async () => {
        const latest = await get(storeName, local.id);
        if (!latest) return;
        latest.isActive = false;
        latest._dirty = false;
        await put(storeName, latest);
      }),
    );
  });

  await Promise.all(operations);
}

export function requeueDirtyRecords(storeName: string, _options?: { content?: boolean }): void {
  void getAll(storeName)
    .then((entities) => {
      entities.forEach((entity) => {
        rememberEntity(storeName, entity.id);
        if (entity._pendingCreate) syncCreateToServer(storeName, entity.id);
        else if (entity._dirty) scheduleMetadataSync(storeName, entity.id);
      });
    })
    .catch((error) => {
      console.warn("[EntityStore] failed to requeue metadata:", storeName, error);
    });
}
