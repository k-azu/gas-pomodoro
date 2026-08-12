/**
 * Metadata store and synchronization.
 *
 * Document bodies and drafts intentionally live in documentRepository. Keeping
 * this module metadata-only prevents body revision and dirty state from being
 * duplicated across entity records and the document stores.
 */

import { serverCall } from "./serverCall";
import { requireMetadataMutationSupport } from "./editPermissions";

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
  collectionSyncKey?: string;
}

interface CollectionSyncIntent {
  key: string;
  storeName: string;
  entityIds: string[];
  args: unknown[];
  mutationId: string;
  updatedAt: string;
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
const collectionSyncDebounces: Record<string, ReturnType<typeof setTimeout>> = {};
const pendingCollectionSyncKeys = new Set<string>();
const syncingCollectionKeys = new Set<string>();
const pendingOperations: Record<string, Promise<any>> = {};
const DATA_CHANGED_CHANNEL = "gas-pomodoro:entity-data-changed";
const COLLECTION_SYNC_STORE = "collectionSyncIntents";
let dataChangedChannel: BroadcastChannel | null | undefined;

function getDataChangedChannel(): BroadcastChannel | null {
  if (dataChangedChannel !== undefined) return dataChangedChannel;
  if (typeof BroadcastChannel === "undefined") {
    dataChangedChannel = null;
    return null;
  }
  dataChangedChannel = new BroadcastChannel(DATA_CHANGED_CHANNEL);
  dataChangedChannel.onmessage = (event: MessageEvent<DataChangedEvent>) => {
    if (event.data.collectionSyncKey) {
      pendingCollectionSyncKeys.add(event.data.collectionSyncKey);
      scheduleCollectionSync(event.data.collectionSyncKey);
    }
    emitLocally("dataChanged", event.data);
  };
  return dataChangedChannel;
}

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
  register(COLLECTION_SYNC_STORE, {
    entityType: "collectionSyncIntent",
    keyPath: "key",
    indexes: [],
  });
  return openDatabase().then(() => {
    getDataChangedChannel();
    void requeueCollectionSyncs();
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
      else void requeueCollectionSyncs();
    });
    window.addEventListener("online", () => void requeueCollectionSyncs());
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
  emitLocally(event, data);
  if (event === "dataChanged" && data) getDataChangedChannel()?.postMessage(data);
}

function emitLocally(event: string, data?: any): void {
  (listeners[event] || []).slice().forEach((callback) => {
    try {
      callback(data);
    } catch (error) {
      console.error(`[EntityStore] listener failed for ${event}:`, error);
    }
  });
}

export function addEntity(storeName: string, entityData: Record<string, any>): Promise<string> {
  requireMetadataMutationSupport();
  const now = new Date().toISOString();
  const item: any = {
    sortOrder: Date.now(),
    isActive: true,
    createdAt: now,
    updatedAt: now,
    contentRevision: 1,
    _dirty: true,
    _pendingCreate: true,
    _metadataVersion: 0,
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
  requireMetadataMutationSupport();
  rememberEntity(storeName, id);
  return withLock(storeName, id, async () => {
    const item = await get(storeName, id);
    if (!item) return;
    const config = registrations[storeName];
    config?.onUpdateHook?.(item, fields);
    Object.assign(item, fields, {
      updatedAt: new Date().toISOString(),
      _dirty: true,
      _metadataVersion: metadataVersion(item) + 1,
    });
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

export function updateCollectionOrder(
  storeName: string,
  collectionId: string,
  entries: Array<{ id: string; sortOrder: number }>,
  serverArgs: unknown[],
): Promise<void> {
  requireMetadataMutationSupport();
  const config = registrations[storeName];
  if (!config?.serverFns?.reorder) {
    return Promise.reject(new Error(`No reorder transport registered for ${storeName}`));
  }
  const key = scopedKey(storeName, collectionId);
  entries.forEach(({ id }) => rememberEntity(storeName, id));

  return withLock(COLLECTION_SYNC_STORE, key, async () => {
    const db = await openDatabase();
    const intent: CollectionSyncIntent = {
      key,
      storeName,
      entityIds: entries.map(({ id }) => id),
      args: serverArgs,
      mutationId: crypto.randomUUID(),
      updatedAt: new Date().toISOString(),
    };
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction([storeName, COLLECTION_SYNC_STORE], "readwrite");
      const entityStore = transaction.objectStore(storeName);
      entries.forEach(({ id, sortOrder }) => {
        const request = entityStore.get(id);
        request.onsuccess = () => {
          const item = request.result;
          if (!item) return;
          item.sortOrder = sortOrder;
          entityStore.put(item);
        };
      });
      transaction.objectStore(COLLECTION_SYNC_STORE).put(intent);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }).then(() => {
    pendingCollectionSyncKeys.add(key);
    emit("dataChanged", {
      entityType: config.entityType || storeName,
      op: "reorder",
      collectionSyncKey: key,
    });
    scheduleCollectionSync(key);
  });
}

export function setInactive(storeName: string, id: string): Promise<void> {
  requireMetadataMutationSupport();
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

function metadataVersion(entity: Record<string, any>): number {
  const version = Number(entity._metadataVersion);
  return Number.isSafeInteger(version) && version >= 0 ? version : 0;
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
      const capturedMetadataVersion = metadataVersion(entity);
      return retryWithBackoff(() =>
        serverCall(config.serverFns!.add!, ...config.addServerArgs!(entity)),
      ).then((result: any) =>
        withLock(storeName, id, async () => {
          const latest = await get(storeName, id);
          if (!latest) return false;
          latest._pendingCreate = false;
          latest._serverUpdatedAt = result?.updatedAt;
          const archivedBeforeCreateFinished = latest.isActive === false;
          // An archive is a separate durable intent. Keep it dirty until the
          // archive endpoint acknowledges it, even when metadata did not change.
          if (
            metadataVersion(latest) === capturedMetadataVersion &&
            !archivedBeforeCreateFinished
          ) {
            latest._dirty = false;
          }
          await put(storeName, latest);
          return archivedBeforeCreateFinished;
        }).then((archivedBeforeCreateFinished) => {
          if (archivedBeforeCreateFinished) syncArchiveToServer(storeName, id);
          else syncMetadataToServer(storeName, id);
        }),
      );
    })
    .catch((error) => {
      console.error("[EntityStore] create sync failed:", storeName, id, error);
    });
}

function scheduleMetadataSync(storeName: string, id: string, delay = 1000): void {
  const key = rememberEntity(storeName, id);
  if (metadataDebounces[key]) clearTimeout(metadataDebounces[key]);
  metadataDebounces[key] = setTimeout(() => {
    delete metadataDebounces[key];
    syncMetadataToServer(storeName, id);
  }, delay);
}

function syncMetadataToServer(storeName: string, id: string): void {
  void withLock(storeName, id, async () => {
    const entity = await get(storeName, id);
    if (!entity || entity._pendingCreate || !entity._dirty) return;
    const config = registrations[storeName];
    if (!config?.serverFns?.update) return;
    const capturedMetadataVersion = metadataVersion(entity);
    const clean = stripLocalFields(entity);
    delete clean.id;
    delete clean.createdAt;
    delete clean.content;
    delete clean.contentRevision;
    const result = (await retryWithBackoff(async () => {
      const response = (await serverCall(config.serverFns!.update!, id, clean)) as any;
      if (!response?.updatedAt) {
        throw new Error(`${config.serverFns!.update!} did not acknowledge metadata update`);
      }
      return response;
    })) as any;
    const latest = await get(storeName, id);
    if (!latest) return;
    latest._serverUpdatedAt = result.updatedAt;
    const needsResync = metadataVersion(latest) !== capturedMetadataVersion;
    if (!needsResync) latest._dirty = false;
    await put(storeName, latest);
    return needsResync;
  })
    .then((needsResync) => {
      if (needsResync) scheduleMetadataSync(storeName, id, 0);
    })
    .catch((error) => {
      console.error("[EntityStore] metadata sync failed:", storeName, id, error);
    });
}

export function syncArchiveToServer(storeName: string, id: string): void {
  void get(storeName, id)
    .then((entity) => {
      if (!entity || entity._pendingCreate || entity.isActive !== false) return;
      const config = registrations[storeName];
      if (!config?.serverFns?.archive) return;
      return retryWithBackoff(() => serverCall(config.serverFns!.archive!, id)).then(() =>
        withLock(storeName, id, async () => {
          const latest = await get(storeName, id);
          if (!latest) return false;
          const reactivatedWhileSaving = latest.isActive !== false;
          if (!reactivatedWhileSaving) latest._dirty = false;
          await put(storeName, latest);
          return reactivatedWhileSaving;
        }).then((reactivatedWhileSaving) => {
          // A late archive acknowledgement must not erase a newer unarchive.
          if (reactivatedWhileSaving) syncMetadataToServer(storeName, id);
        }),
      );
    })
    .catch((error) => {
      console.error("[EntityStore] archive sync failed:", storeName, id, error);
    });
}

function scheduleCollectionSync(key: string, delay = 5000): void {
  if (collectionSyncDebounces[key]) clearTimeout(collectionSyncDebounces[key]);
  collectionSyncDebounces[key] = setTimeout(() => {
    delete collectionSyncDebounces[key];
    flushCollectionSync(key);
  }, delay);
}

function flushCollectionSync(key: string): void {
  if (syncingCollectionKeys.has(key) || !navigator.locks) return;
  syncingCollectionKeys.add(key);
  let retryDelay: number | undefined;

  void navigator.locks
    .request(`gas-pomodoro:collection-sync:${key}`, async () => {
      const intent = (await get(COLLECTION_SYNC_STORE, key)) as CollectionSyncIntent | null;
      if (!intent) {
        pendingCollectionSyncKeys.delete(key);
        return false;
      }
      const reorderFunction = registrations[intent.storeName]?.serverFns?.reorder;
      if (!reorderFunction)
        throw new Error(`No reorder transport registered for ${intent.storeName}`);

      await retryWithBackoff(async () => {
        const response = (await serverCall(reorderFunction, ...intent.args)) as any;
        if (response?.success !== true) {
          throw new Error(`${reorderFunction} did not acknowledge collection order`);
        }
      });

      return await withLock(COLLECTION_SYNC_STORE, key, async () => {
        const latest = (await get(COLLECTION_SYNC_STORE, key)) as CollectionSyncIntent | null;
        if (!latest) return false;
        if (latest.mutationId !== intent.mutationId) return true;
        await remove(COLLECTION_SYNC_STORE, key);
        pendingCollectionSyncKeys.delete(key);
        return false;
      });
    })
    .then(async (needsResync) => {
      if (await needsResync) retryDelay = 0;
    })
    .catch((error) => {
      console.error("[EntityStore] collection sync failed:", key, error);
      retryDelay = 30_000;
    })
    .finally(() => {
      syncingCollectionKeys.delete(key);
      if (retryDelay !== undefined) scheduleCollectionSync(key, retryDelay);
    });
}

async function requeueCollectionSyncs(): Promise<void> {
  if (!navigator.locks) return;
  try {
    const intents = (await getAll(COLLECTION_SYNC_STORE)) as CollectionSyncIntent[];
    intents.forEach((intent) => {
      pendingCollectionSyncKeys.add(intent.key);
      scheduleCollectionSync(intent.key, 0);
    });
  } catch (error) {
    console.warn("[EntityStore] failed to requeue collection sync:", error);
  }
}

export function hasPendingChanges(): boolean {
  return (
    Object.keys(metadataDebounces).length > 0 ||
    pendingCollectionSyncKeys.size > 0 ||
    Object.keys(collectionSyncDebounces).length > 0
  );
}

export function flushAllSyncs(): void {
  Object.entries(metadataDebounces).forEach(([key, timer]) => {
    clearTimeout(timer);
    delete metadataDebounces[key];
    const entity = entityStoreMap[key];
    if (entity) syncMetadataToServer(entity.storeName, entity.id);
  });
  pendingCollectionSyncKeys.forEach((key) => {
    const timer = collectionSyncDebounces[key];
    if (timer) {
      clearTimeout(timer);
      delete collectionSyncDebounces[key];
    }
    flushCollectionSync(key);
  });
}

export async function mergeServerData(storeName: string, serverEntities: any[]): Promise<void> {
  const [localEntities, collectionIntents] = await Promise.all([
    getAll(storeName),
    getAll(COLLECTION_SYNC_STORE) as Promise<CollectionSyncIntent[]>,
  ]);
  const pendingOrderIds = new Set(
    collectionIntents
      .filter((intent) => intent.storeName === storeName)
      .flatMap((intent) => intent.entityIds || []),
  );
  const serverById = new Map(serverEntities.map((entity) => [entity.id, entity]));
  const operations: Promise<unknown>[] = [];

  serverEntities.forEach((serverEntity) => {
    rememberEntity(storeName, serverEntity.id);
    operations.push(
      withLock(storeName, serverEntity.id, async () => {
        const latest = await get(storeName, serverEntity.id);
        if (!latest) {
          await put(storeName, {
            ...serverEntity,
            _serverUpdatedAt: serverEntity.updatedAt,
            _dirty: false,
          });
          return;
        }

        if (latest._dirty) {
          latest._serverUpdatedAt = serverEntity.updatedAt;
          await put(storeName, latest);
          if (latest.isActive === false) syncArchiveToServer(storeName, serverEntity.id);
          else scheduleMetadataSync(storeName, serverEntity.id);
          return;
        }

        const privateFields = Object.fromEntries(
          Object.entries(latest).filter(
            ([key]) => key.startsWith("_") && !key.startsWith("_cached"),
          ),
        );
        const legacyBodyFields =
          latest.content !== undefined || latest._serverContent !== undefined
            ? {
                content: latest.content,
                _serverContent: latest._serverContent,
                _contentDirtyAt: latest._contentDirtyAt,
                _contentDirtyOwner: latest._contentDirtyOwner,
                _draftBaseRevision: latest._draftBaseRevision,
                contentRevision: latest.contentRevision,
              }
            : {};
        await put(storeName, {
          ...serverEntity,
          ...(pendingOrderIds.has(serverEntity.id) ? { sortOrder: latest.sortOrder } : {}),
          ...privateFields,
          ...legacyBodyFields,
          _serverUpdatedAt: serverEntity.updatedAt,
          _dirty: false,
        });
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
        else if (entity._dirty && entity.isActive === false) {
          syncArchiveToServer(storeName, entity.id);
        } else if (entity._dirty) {
          scheduleMetadataSync(storeName, entity.id);
        }
      });
    })
    .catch((error) => {
      console.warn("[EntityStore] failed to requeue metadata:", storeName, error);
    });
}
