import { selectDocumentContent, type CommittedDocumentBody } from "./documentContentModel";
import { refreshDocumentContent } from "./documentContentStore";
import {
  acceptRemoteDraft,
  getActiveDocumentDrafts,
  moveRejectedDraftToRecovery,
  migrateLegacyDocumentStore,
  readDocumentContent,
  recordAcceptedDocumentSave,
  recordRemoteDocument,
  saveDocumentEdit,
  toDocumentKey,
} from "./documentRepository";
import * as EntityStore from "./entityStore";
import { publishDocumentInvalidation, publishRecoveryInvalidation } from "./documentInvalidation";
import { clearDocumentSyncError, publishDocumentSyncError } from "./documentSyncErrors";

export interface DocumentContentSaveOptions {
  immediateSync?: boolean;
  resolveConflict?: boolean;
  baseRevision?: number;
  mutationId?: string;
}

export interface RemoteDocumentContent {
  content?: string;
  contentRevision?: number;
  updatedAt?: string;
}

export interface DocumentSaveResponse {
  status: "saved" | "conflict" | "notFound" | "inactive";
  content?: string;
  revision?: number;
  updatedAt?: string;
  mutationId?: string;
}

interface DocumentTransport {
  load(id: string): Promise<RemoteDocumentContent | null>;
  save(
    id: string,
    content: string,
    baseRevision: number,
    mutationId: string,
  ): Promise<DocumentSaveResponse>;
}

const transports = new Map<string, DocumentTransport>();
const syncTimers = new Map<string, ReturnType<typeof setTimeout>>();
const syncInFlight = new Set<string>();
const syncRequested = new Set<string>();
const retryState = new Map<string, { storeName: string; id: string; attempt: number }>();
const localMutationIds = new Set<string>();
const SERVER_SYNC_DELAY_MS = 30_000;
const MAX_RETRY_DELAY_MS = 30_000;
const CONTENT_REQUEST_TIMEOUT_MS = 45_000;

function withContentRequestTimeout<T>(operation: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Document content request timed out")),
      CONTENT_REQUEST_TIMEOUT_MS,
    );
    operation.then(
      (result) => {
        clearTimeout(timer);
        resolve(result);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function isDev(): boolean {
  return Boolean((import.meta as any).env?.DEV);
}

function rememberLocalMutation(mutationId: string): void {
  localMutationIds.add(mutationId);
  if (localMutationIds.size <= 256) return;
  const oldest = localMutationIds.values().next().value;
  if (oldest) localMutationIds.delete(oldest);
}

export function registerDocumentTransport(storeName: string, transport: DocumentTransport): void {
  transports.set(storeName, transport);
}

async function withDocumentSyncLock<T>(documentKey: string, operation: () => Promise<T>) {
  if (!navigator.locks) return operation();
  return navigator.locks.request(`gas-pomodoro:sync:${documentKey}`, operation);
}

function clearScheduledSync(documentKey: string): void {
  const timer = syncTimers.get(documentKey);
  if (timer) clearTimeout(timer);
  syncTimers.delete(documentKey);
}

function scheduleDocumentSync(storeName: string, id: string, delayMs = SERVER_SYNC_DELAY_MS): void {
  const key = toDocumentKey(storeName, id);
  clearScheduledSync(key);
  syncTimers.set(
    key,
    setTimeout(() => {
      syncTimers.delete(key);
      void syncDocumentContent(storeName, id);
    }, delayMs),
  );
}

function clearRetry(documentKey: string): void {
  retryState.delete(documentKey);
}

function scheduleRetry(storeName: string, id: string): void {
  const key = toDocumentKey(storeName, id);
  const attempt = (retryState.get(key)?.attempt ?? 0) + 1;
  retryState.set(key, { storeName, id, attempt });
  const delayMs = Math.min(MAX_RETRY_DELAY_MS, 1_000 * 2 ** (attempt - 1));
  scheduleDocumentSync(storeName, id, delayMs);
}

function retryFailedDocumentsNow(): void {
  retryState.forEach(({ storeName, id }) => scheduleDocumentSync(storeName, id, 0));
}

if (typeof window !== "undefined") {
  window.addEventListener("online", retryFailedDocumentsNow);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") retryFailedDocumentsNow();
  });
}

async function rejectUnavailableDocument(storeName: string, id: string): Promise<boolean> {
  const entity = await EntityStore.get(storeName, id);
  if (entity && entity.isActive !== false) return false;
  await moveRejectedDraftToRecovery(storeName, id, {
    reason: entity ? "inactive" : "notFound",
    recoveryId: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  });
  publishRecoveryInvalidation();
  publishDocumentInvalidation(storeName, id);
  return true;
}

async function performDocumentSync(storeName: string, id: string): Promise<void> {
  const key = toDocumentKey(storeName, id);
  const transport = transports.get(storeName);
  if (!transport) {
    clearRetry(key);
    clearDocumentSyncError(storeName, id);
    return;
  }
  const entity = await EntityStore.get(storeName, id);
  if (!entity) {
    await rejectUnavailableDocument(storeName, id);
    clearRetry(key);
    return;
  }
  if (entity.isActive === false) {
    await rejectUnavailableDocument(storeName, id);
    clearRetry(key);
    return;
  }
  if (entity._pendingCreate) {
    scheduleDocumentSync(storeName, id, 1_000);
    return;
  }
  const state = await readDocumentContent(storeName, id);
  if (state?.draft?.kind !== "pending") {
    clearRetry(key);
    clearDocumentSyncError(storeName, id);
    return;
  }
  const pending = state.draft;
  rememberLocalMutation(pending.mutationId);

  try {
    const result = await withContentRequestTimeout(
      transport.save(id, pending.content, pending.baseRevision, pending.mutationId),
    );
    if (result.status === "saved") {
      const revision = Number(result.revision);
      if (!Number.isFinite(revision) || revision < 1) {
        throw new Error("Invalid content save response revision");
      }
      const updatedAt = String(result.updatedAt || "");
      const next = await recordAcceptedDocumentSave(storeName, id, {
        requestMutationId: pending.mutationId,
        content: pending.content,
        revision,
        updatedAt,
      });
      clearRetry(key);
      clearDocumentSyncError(storeName, id);
      publishDocumentInvalidation(storeName, id);
      if (next?.draft?.kind === "pending") syncRequested.add(key);
      return;
    }

    if (result.status === "conflict") {
      const remote = {
        content: String(result.content || ""),
        revision: Math.max(1, Number(result.revision) || 1),
        updatedAt: String(result.updatedAt || ""),
      };
      await recordRemoteDocument(storeName, id, remote);
      clearRetry(key);
      clearDocumentSyncError(storeName, id);
      publishDocumentInvalidation(storeName, id);
      return;
    }

    await moveRejectedDraftToRecovery(storeName, id, {
      reason: result.status,
      recoveryId: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    });
    publishRecoveryInvalidation();
    clearRetry(key);
    publishDocumentInvalidation(storeName, id);
    publishDocumentSyncError({
      storeName,
      id,
      error: new Error(`Content save rejected: ${result.status}`),
      mutationId: pending.mutationId,
      terminal: true,
    });
  } catch (error) {
    console.error("[DocumentCoordinator] Content sync failed:", storeName, id, error);
    publishDocumentSyncError({ storeName, id, error, mutationId: pending.mutationId });
    scheduleRetry(storeName, id);
  }
}

export async function syncDocumentContent(storeName: string, id: string): Promise<void> {
  const key = toDocumentKey(storeName, id);
  if (syncInFlight.has(key)) {
    syncRequested.add(key);
    return;
  }
  syncInFlight.add(key);
  try {
    await withDocumentSyncLock(key, () => performDocumentSync(storeName, id));
  } finally {
    syncInFlight.delete(key);
    if (syncRequested.delete(key)) void syncDocumentContent(storeName, id);
  }
}

export async function saveDocumentContent(
  storeName: string,
  id: string,
  content: string,
  options?: DocumentContentSaveOptions,
): Promise<void> {
  if (isDev() && (window as any).__mockLocalSaveShouldFailOnce) {
    (window as any).__mockLocalSaveShouldFailOnce = false;
    const delay = Math.max(0, Number((window as any).__mockLocalSaveFailureDelayMs) || 0);
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    throw new Error("Mock: forced local save error");
  }
  const mutationId = options?.mutationId || crypto.randomUUID();
  rememberLocalMutation(mutationId);
  const current = await readDocumentContent(storeName, id);
  const baseRevision = Math.max(
    0,
    Number(options?.baseRevision ?? current?.committed.revision ?? 0) || 0,
  );
  const allowRebase = Boolean(
    current?.committed.mutationId && localMutationIds.has(current.committed.mutationId),
  );
  const resolveConflict = Boolean(
    current?.draft?.kind === "conflict" &&
    options?.resolveConflict &&
    options.baseRevision === current.draft.remote.revision,
  );
  const next = await saveDocumentEdit(
    storeName,
    id,
    content,
    baseRevision,
    mutationId,
    new Date().toISOString(),
    allowRebase,
    resolveConflict,
  );
  if (!next) throw new Error(`Cannot save missing document: ${storeName}/${id}`);
  publishDocumentInvalidation(storeName, id);
  if (options?.immediateSync) {
    clearScheduledSync(toDocumentKey(storeName, id));
    void syncDocumentContent(storeName, id);
  } else {
    scheduleDocumentSync(storeName, id);
  }
}

export async function getDocumentContentSnapshot(storeName: string, id: string) {
  return refreshDocumentContent(storeName, id);
}

export async function resolveDocumentWithServer(storeName: string, id: string) {
  const transport = transports.get(storeName);
  if (!transport) return null;
  const remoteResult = await withContentRequestTimeout(transport.load(id));
  if (!remoteResult) return { useServer: false };
  const remote = {
    content: String(remoteResult.content || ""),
    revision: Math.max(1, Number(remoteResult.contentRevision) || 1),
    updatedAt: String(remoteResult.updatedAt || ""),
  };
  const state = await recordRemoteDocument(storeName, id, remote);
  publishDocumentInvalidation(storeName, id);
  if (!state) return { useServer: false, revision: remote.revision };
  if (state.draft?.kind === "conflict") {
    return { useServer: false, revision: state.draft.remote.revision };
  }
  if (state.draft?.kind === "pending") {
    scheduleDocumentSync(storeName, id);
    return { useServer: false, revision: remote.revision };
  }
  return {
    useServer: true,
    content: state.committed.content,
    revision: state.committed.revision,
  };
}

export async function acceptCommittedDocument(
  storeName: string,
  id: string,
  remote: CommittedDocumentBody,
) {
  await recordRemoteDocument(storeName, id, remote);
  const state = await acceptRemoteDraft(storeName, id, remote.revision);
  publishDocumentInvalidation(storeName, id);
  return state ? selectDocumentContent(state) : null;
}

export function flushDocumentContentSync(storeName: string, id: string): void {
  clearScheduledSync(toDocumentKey(storeName, id));
  void syncDocumentContent(storeName, id);
}

export function requeueDocumentDrafts(storeName: string): void {
  void migrateLegacyDocumentStore(storeName)
    .then(() => {
      publishRecoveryInvalidation();
      return getActiveDocumentDrafts(storeName);
    })
    .then(async (drafts) => {
      await Promise.all(
        drafts.map(async (draft) => {
          const id = draft.key.slice(storeName.length + 1);
          if (await rejectUnavailableDocument(storeName, id)) return;
          if (draft.kind !== "pending") return;
          scheduleDocumentSync(storeName, id);
        }),
      );
    })
    .catch((error) => {
      console.error("[DocumentCoordinator] Failed to requeue document drafts:", storeName, error);
    });
}
