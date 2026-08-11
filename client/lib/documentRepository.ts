import {
  acceptRemoteDocument,
  applyRemoteDocument,
  applySaveAccepted,
  editDocument,
  keepLocalDocument,
  rejectDocumentDraft,
  type ActiveDocumentDraft,
  type CommittedDocumentBody,
  type DocumentContentState,
  type RecoveryDocumentDraft,
  type RemoteDocumentEvent,
  type SaveAcceptedEvent,
  type TerminalRejectionEvent,
} from "./documentContentModel";
import { getDatabase, register } from "./entityStore";

export const DOCUMENT_BODY_STORE = "documentBodies";
export const ACTIVE_DOCUMENT_DRAFT_STORE = "activeDocumentDrafts";
export const RECOVERY_DOCUMENT_DRAFT_STORE = "recoveryDocumentDrafts";
const LEGACY_DRAFT_STORE = "documentDrafts";

/** Register the document persistence schema before EntityStore opens IndexedDB. */
export function registerDocumentRepositoryStores(): void {
  register(LEGACY_DRAFT_STORE, {
    entityType: "documentDraft",
    keyPath: "key",
    indexes: [],
  });
  register(DOCUMENT_BODY_STORE, {
    entityType: "documentBody",
    keyPath: "key",
    indexes: [],
  });
  register(ACTIVE_DOCUMENT_DRAFT_STORE, {
    entityType: "activeDocumentDraft",
    keyPath: "key",
    indexes: [],
  });
  register(RECOVERY_DOCUMENT_DRAFT_STORE, {
    entityType: "recoveryDocumentDraft",
    keyPath: "recoveryId",
    indexes: [{ name: "documentKey", keyPath: "documentKey", options: { unique: false } }],
  });
}

interface LegacyDraft {
  key: string;
  storeName: string;
  id: string;
  content?: string;
  baseRevision?: number;
  mutationId?: string;
  dirtyAt?: string;
  conflict?: { content?: string; revision?: number; updatedAt?: string };
  recoveryState?: "conflicting" | "rejected";
  recoveryReason?: "inactive" | "notFound";
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export function toDocumentKey(storeName: string, id: string): string {
  return `${storeName}:${id}`;
}

function localVersion(updatedAt: string | undefined): number {
  return Math.max(1, Date.parse(String(updatedAt || "")) || 1);
}

function pendingFromLegacy(key: string, draft: LegacyDraft): ActiveDocumentDraft {
  const updatedAt = String(draft.dirtyAt || new Date().toISOString());
  if (draft.conflict) {
    return {
      kind: "conflict",
      key,
      localContent: String(draft.content || ""),
      localVersion: localVersion(updatedAt),
      updatedAt,
      remote: {
        key,
        content: String(draft.conflict.content || ""),
        revision: Math.max(0, Number(draft.conflict.revision) || 0),
        updatedAt: String(draft.conflict.updatedAt || ""),
      },
    };
  }
  return {
    kind: "pending",
    key,
    content: String(draft.content || ""),
    baseRevision: Math.max(0, Number(draft.baseRevision) || 0),
    mutationId: String(draft.mutationId || crypto.randomUUID()),
    localVersion: localVersion(updatedAt),
    updatedAt,
  };
}

function recoveryFromLegacy(key: string, draft: LegacyDraft, index: number): RecoveryDocumentDraft {
  const createdAt = String(draft.dirtyAt || new Date().toISOString());
  return {
    recoveryId: `legacy:${draft.key || `${key}:${index}`}`,
    documentKey: key,
    content: String(draft.content || ""),
    createdAt,
    reason:
      draft.recoveryReason === "inactive" || draft.recoveryReason === "notFound"
        ? draft.recoveryReason
        : "superseded",
  };
}

function committedFromLegacy(storeName: string, entity: any): CommittedDocumentBody {
  const key = toDocumentKey(storeName, String(entity.id));
  const hasExplicitServerContent = entity._serverContent !== undefined;
  const hasLegacyContent = hasExplicitServerContent || entity.content !== undefined;
  return {
    key,
    content: String(
      hasExplicitServerContent
        ? entity._serverContent
        : entity._contentDirtyAt
          ? ""
          : entity.content || "",
    ),
    // A list response may contain contentRevision without the body itself.
    // Revision 0 means "body not loaded yet", so the first content fetch is
    // never discarded as an already-applied revision. A locally-created
    // entity is the exception: its server-side empty body starts at revision 1.
    revision: entity._pendingCreate
      ? 1
      : hasLegacyContent
        ? Math.max(0, Number(entity.contentRevision) || 0)
        : 0,
    updatedAt: String(entity._serverUpdatedAt || entity.updatedAt || ""),
  };
}

function fallbackDraftFromEntity(key: string, entity: any): ActiveDocumentDraft | null {
  if (!entity._contentDirtyAt) return null;
  const updatedAt = String(entity._contentDirtyAt);
  return {
    kind: "pending",
    key,
    content: String(entity.content || ""),
    baseRevision: Math.max(
      0,
      Number(entity._draftBaseRevision ?? entity.contentRevision ?? 0) || 0,
    ),
    mutationId: crypto.randomUUID(),
    localVersion: localVersion(updatedAt),
    updatedAt,
  };
}

/**
 * Idempotently imports one legacy entity and all of its per-tab drafts.
 * The newest syncable draft becomes the single active draft; every other body
 * is copied to the recovery store before the migration is considered complete.
 */
export async function migrateLegacyDocument(
  storeName: string,
  id: string,
): Promise<DocumentContentState | null> {
  const db = await getDatabase();
  const stores = [
    storeName,
    LEGACY_DRAFT_STORE,
    DOCUMENT_BODY_STORE,
    ACTIVE_DOCUMENT_DRAFT_STORE,
    RECOVERY_DOCUMENT_DRAFT_STORE,
  ];
  const transaction = db.transaction(stores, "readwrite");
  const completion = transactionComplete(transaction);
  const key = toDocumentKey(storeName, id);
  const bodyStore = transaction.objectStore(DOCUMENT_BODY_STORE);
  const activeStore = transaction.objectStore(ACTIVE_DOCUMENT_DRAFT_STORE);
  const [existingBody, existingDraft, entity, legacyDrafts] = await Promise.all([
    requestResult(bodyStore.get(key)) as Promise<CommittedDocumentBody | undefined>,
    requestResult(activeStore.get(key)) as Promise<ActiveDocumentDraft | undefined>,
    requestResult(transaction.objectStore(storeName).get(id)),
    requestResult(transaction.objectStore(LEGACY_DRAFT_STORE).getAll()) as Promise<LegacyDraft[]>,
  ]);

  const related = legacyDrafts
    .filter((draft) => draft.storeName === storeName && draft.id === id)
    .sort((a, b) => String(b.dirtyAt || "").localeCompare(String(a.dirtyAt || "")));
  const legacyStore = transaction.objectStore(LEGACY_DRAFT_STORE);
  const recoveryStore = transaction.objectStore(RECOVERY_DOCUMENT_DRAFT_STORE);

  if (existingBody) {
    // A previous migration may have committed the body before legacy drafts
    // were cleaned up. Preserve every remaining draft rather than hiding it.
    related.forEach((draft, index) => {
      recoveryStore.put({
        ...recoveryFromLegacy(key, draft, index),
        reason: entity ? "superseded" : "notFound",
      });
      legacyStore.delete(draft.key);
    });
    await completion;
    return { committed: existingBody, draft: existingDraft ?? null };
  }
  if (!entity) {
    // Legacy per-tab drafts can outlive their metadata row. They cannot be
    // synchronized, but their body must remain discoverable in Recovery.
    related.forEach((draft, index) => {
      recoveryStore.put({ ...recoveryFromLegacy(key, draft, index), reason: "notFound" });
      legacyStore.delete(draft.key);
    });
    await completion;
    return null;
  }

  const committed = committedFromLegacy(storeName, entity);
  const syncable = related.filter((draft) => !draft.recoveryState);
  const winner = syncable[0];
  const activeDraft = winner
    ? pendingFromLegacy(key, winner)
    : fallbackDraftFromEntity(key, entity);
  related
    .filter((draft) => draft !== winner)
    .forEach((draft, index) => recoveryStore.put(recoveryFromLegacy(key, draft, index)));

  bodyStore.put(committed);
  if (activeDraft) activeStore.put(activeDraft);
  related.forEach((draft) => legacyStore.delete(draft.key));
  delete entity.content;
  delete entity._serverContent;
  delete entity._contentDirtyAt;
  delete entity._contentDirtyOwner;
  delete entity._draftBaseRevision;
  transaction.objectStore(storeName).put(entity);
  await completion;
  return { committed, draft: activeDraft };
}

export async function readDocumentContent(
  storeName: string,
  id: string,
): Promise<DocumentContentState | null> {
  const db = await getDatabase();
  const transaction = db.transaction(
    [DOCUMENT_BODY_STORE, ACTIVE_DOCUMENT_DRAFT_STORE],
    "readonly",
  );
  const completion = transactionComplete(transaction);
  const key = toDocumentKey(storeName, id);
  const [committed, draft] = await Promise.all([
    requestResult(transaction.objectStore(DOCUMENT_BODY_STORE).get(key)) as Promise<
      CommittedDocumentBody | undefined
    >,
    requestResult(transaction.objectStore(ACTIVE_DOCUMENT_DRAFT_STORE).get(key)) as Promise<
      ActiveDocumentDraft | undefined
    >,
  ]);
  await completion;
  if (committed) return { committed, draft: draft ?? null };
  return migrateLegacyDocument(storeName, id);
}

export async function migrateLegacyDocumentStore(storeName: string): Promise<void> {
  const db = await getDatabase();
  const transaction = db.transaction([storeName, LEGACY_DRAFT_STORE], "readonly");
  const completion = transactionComplete(transaction);
  const [entities, legacyDrafts] = await Promise.all([
    requestResult(transaction.objectStore(storeName).getAll()) as Promise<Array<{ id: string }>>,
    requestResult(transaction.objectStore(LEGACY_DRAFT_STORE).getAll()) as Promise<LegacyDraft[]>,
  ]);
  await completion;
  const ids = new Set(entities.map((entity) => String(entity.id)));
  legacyDrafts.forEach((draft) => {
    if (draft.storeName === storeName) ids.add(String(draft.id));
  });
  await Promise.all(Array.from(ids, (id) => migrateLegacyDocument(storeName, id)));
}

interface StateUpdate {
  state: DocumentContentState;
  recovery?: RecoveryDocumentDraft | null;
}

async function updateDocumentContent(
  storeName: string,
  id: string,
  update: (state: DocumentContentState) => StateUpdate,
): Promise<DocumentContentState | null> {
  const migrated = await readDocumentContent(storeName, id);
  if (!migrated) return null;

  const db = await getDatabase();
  const transaction = db.transaction(
    [DOCUMENT_BODY_STORE, ACTIVE_DOCUMENT_DRAFT_STORE, RECOVERY_DOCUMENT_DRAFT_STORE],
    "readwrite",
  );
  const completion = transactionComplete(transaction);
  const key = toDocumentKey(storeName, id);
  const bodyStore = transaction.objectStore(DOCUMENT_BODY_STORE);
  const draftStore = transaction.objectStore(ACTIVE_DOCUMENT_DRAFT_STORE);
  const [committed, draft] = await Promise.all([
    requestResult(bodyStore.get(key)) as Promise<CommittedDocumentBody | undefined>,
    requestResult(draftStore.get(key)) as Promise<ActiveDocumentDraft | undefined>,
  ]);
  if (!committed) {
    await completion;
    return null;
  }

  const result = update({ committed, draft: draft ?? null });
  bodyStore.put(result.state.committed);
  if (result.state.draft) {
    draftStore.put(result.state.draft);
  } else {
    draftStore.delete(key);
  }
  if (result.recovery) {
    transaction.objectStore(RECOVERY_DOCUMENT_DRAFT_STORE).put(result.recovery);
  }
  await completion;
  return result.state;
}

export function saveDocumentEdit(
  storeName: string,
  id: string,
  content: string,
  baseRevision: number,
  mutationId: string,
  updatedAt: string,
  allowRebase: boolean,
  resolveConflict = false,
): Promise<DocumentContentState | null> {
  return updateDocumentContent(storeName, id, (state) => {
    const edited = editDocument(state, {
      content,
      baseRevision,
      allowRebase,
      mutationId,
      updatedAt,
      localVersion: (state.draft?.localVersion ?? 0) + 1,
    });
    return {
      state: resolveConflict ? keepLocalDocument(edited, mutationId, updatedAt) : edited,
    };
  });
}

export function recordAcceptedDocumentSave(
  storeName: string,
  id: string,
  event: SaveAcceptedEvent,
): Promise<DocumentContentState | null> {
  return updateDocumentContent(storeName, id, (state) => ({
    state: applySaveAccepted(state, event),
  }));
}

export function recordRemoteDocument(
  storeName: string,
  id: string,
  event: RemoteDocumentEvent,
): Promise<DocumentContentState | null> {
  return updateDocumentContent(storeName, id, (state) => ({
    state: applyRemoteDocument(state, event),
  }));
}

export function keepLocalDraft(
  storeName: string,
  id: string,
  mutationId: string,
  updatedAt: string,
): Promise<DocumentContentState | null> {
  return updateDocumentContent(storeName, id, (state) => ({
    state: keepLocalDocument(state, mutationId, updatedAt),
  }));
}

export function acceptRemoteDraft(
  storeName: string,
  id: string,
  expectedRevision: number,
): Promise<DocumentContentState | null> {
  return updateDocumentContent(storeName, id, (state) => ({
    state: acceptRemoteDocument(state, expectedRevision),
  }));
}

export function moveRejectedDraftToRecovery(
  storeName: string,
  id: string,
  event: TerminalRejectionEvent,
): Promise<DocumentContentState | null> {
  return updateDocumentContent(storeName, id, (state) => {
    const rejected = rejectDocumentDraft(state, event);
    return { state: rejected.state, recovery: rejected.recovery };
  });
}

export async function getRecoveryDocumentDrafts(): Promise<RecoveryDocumentDraft[]> {
  const db = await getDatabase();
  const transaction = db.transaction(RECOVERY_DOCUMENT_DRAFT_STORE, "readonly");
  const completion = transactionComplete(transaction);
  const drafts = (await requestResult(
    transaction.objectStore(RECOVERY_DOCUMENT_DRAFT_STORE).getAll(),
  )) as RecoveryDocumentDraft[];
  await completion;
  return drafts.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function discardRecoveryDocumentDraft(recoveryId: string): Promise<void> {
  const db = await getDatabase();
  const transaction = db.transaction(RECOVERY_DOCUMENT_DRAFT_STORE, "readwrite");
  const completion = transactionComplete(transaction);
  transaction.objectStore(RECOVERY_DOCUMENT_DRAFT_STORE).delete(recoveryId);
  await completion;
}

export async function getActiveDocumentDrafts(storeName?: string): Promise<ActiveDocumentDraft[]> {
  const db = await getDatabase();
  const transaction = db.transaction(ACTIVE_DOCUMENT_DRAFT_STORE, "readonly");
  const completion = transactionComplete(transaction);
  const drafts = (await requestResult(
    transaction.objectStore(ACTIVE_DOCUMENT_DRAFT_STORE).getAll(),
  )) as ActiveDocumentDraft[];
  await completion;
  return storeName ? drafts.filter((draft) => draft.key.startsWith(`${storeName}:`)) : drafts;
}
