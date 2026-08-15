import type { Case, Memo, Project, Task } from "../types/entities";
import { serverCall } from "./serverCall";

export type DocumentStoreName = "memos" | "projects" | "cases" | "tasks";
export type DocumentEntity = Memo | Project | Case | Task;

interface DocumentData {
  memos: Memo[];
  projects: Project[];
  cases: Case[];
  tasks: Task[];
}

export interface ContentSnapshot {
  documentKey: string;
  content: string;
  revision: number;
  updatedAt: string;
  lastMutationId: string;
}

export interface MetadataSnapshot {
  documentKey: string;
  revision: number;
  updatedAt: string;
  lastMutationId: string;
  metadata: Record<string, unknown>;
}

type ContentMutationResult =
  | { status: "applied"; mutationId: string; snapshot: ContentSnapshot }
  | { status: "conflict"; mutationId: string; snapshot: ContentSnapshot }
  | { status: "missing"; mutationId: string };

type MetadataMutationResult =
  | { status: "applied"; mutationId: string; snapshot: MetadataSnapshot }
  | { status: "conflict"; mutationId: string; snapshot: MetadataSnapshot }
  | { status: "missing"; mutationId: string }
  | { status: "rejected"; mutationId: string; reason: string };

export class DocumentContentConflictError extends Error {
  constructor(
    readonly localContent: string,
    readonly remote: ContentSnapshot,
  ) {
    super("The document was updated on another tab or device");
    this.name = "DocumentContentConflictError";
  }
}

export class DocumentMetadataConflictError extends Error {
  constructor(readonly remote: MetadataSnapshot) {
    super("The document metadata was updated on another tab or device");
    this.name = "DocumentMetadataConflictError";
  }
}

export type DocumentEvent = {
  entityType: "memo" | "project" | "case" | "task" | "all";
  op: string;
  id?: string;
  storeName?: DocumentStoreName;
  contentSnapshot?: ContentSnapshot;
  metadataSnapshot?: MetadataSnapshot;
};
type Listener = (event: DocumentEvent) => void;

const stores: Record<DocumentStoreName, Map<string, DocumentEntity>> = {
  memos: new Map(),
  projects: new Map(),
  cases: new Map(),
  tasks: new Map(),
};
const listeners = new Set<Listener>();
let localGeneration = 0;
const metadataQueues = new Map<string, Promise<void>>();
const contentAttempts = new Map<
  string,
  { content: string; expectedRevision: number; mutationId: string }
>();
interface PendingMetadata {
  storeName: DocumentStoreName;
  id: string;
  patch: Record<string, unknown>;
  attempt?: {
    patch: Record<string, unknown>;
    expectedRevision: number;
    mutationId: string;
  };
}
const metadataPending = new Map<string, PendingMetadata>();
const channelSource = crypto.randomUUID();
type ConfirmedChange =
  | {
      kind: "content";
      storeName: DocumentStoreName;
      id: string;
      snapshot: ContentSnapshot;
    }
  | {
      kind: "metadata";
      storeName: DocumentStoreName;
      id: string;
      snapshot: MetadataSnapshot;
    };
const syncChannel =
  typeof window === "undefined" || typeof BroadcastChannel === "undefined"
    ? null
    : new BroadcastChannel("gas-pomodoro:document-confirmed:v1");

syncChannel?.addEventListener("message", (event: MessageEvent) => {
  const message = event.data as {
    source?: string;
    type?: string;
    change?: ConfirmedChange;
  } | null;
  if (!message || message.source === channelSource || message.type !== "document-confirmed") {
    return;
  }
  if (message.change?.kind === "content") {
    const { storeName, id, snapshot } = message.change;
    emit({
      entityType: entityTypeFor(storeName),
      op: "remoteContentConfirmed",
      id,
      storeName,
      contentSnapshot: snapshot,
    });
    return;
  }
  if (message.change?.kind === "metadata") {
    const { storeName, id, snapshot } = message.change;
    emit({
      entityType: entityTypeFor(storeName),
      op: "remoteMetadataConfirmed",
      id,
      storeName,
      metadataSnapshot: snapshot,
    });
    return;
  }
  emit({ entityType: "all", op: "remoteInvalidation" });
});

function documentKey(storeName: DocumentStoreName, id: string): string {
  return `${storeName}:${id}`;
}

function latestUpdatedAt(current: string, incoming: string): string {
  return current.localeCompare(incoming) >= 0 ? current : incoming;
}

function entityTypeFor(storeName: DocumentStoreName): DocumentEvent["entityType"] {
  if (storeName === "memos") return "memo";
  if (storeName === "projects") return "project";
  if (storeName === "cases") return "case";
  return "task";
}

function emit(event: DocumentEvent): void {
  listeners.forEach((listener) => {
    try {
      listener(event);
    } catch (error) {
      console.error("[DocumentStore] listener failed", error);
    }
  });
}

export function notifyDocumentCollectionChanged(): void {
  syncChannel?.postMessage({ source: channelSource, type: "document-confirmed" });
}

function notifyContentConfirmed(
  storeName: DocumentStoreName,
  id: string,
  snapshot: ContentSnapshot,
): void {
  syncChannel?.postMessage({
    source: channelSource,
    type: "document-confirmed",
    change: { kind: "content", storeName, id, snapshot } satisfies ConfirmedChange,
  });
}

function notifyMetadataConfirmed(
  storeName: DocumentStoreName,
  id: string,
  snapshot: MetadataSnapshot,
): void {
  syncChannel?.postMessage({
    source: channelSource,
    type: "document-confirmed",
    change: { kind: "metadata", storeName, id, snapshot } satisfies ConfirmedChange,
  });
}

function replaceStore<T extends DocumentEntity>(storeName: DocumentStoreName, entities: T[]): void {
  const next = new Map<string, DocumentEntity>();
  entities.forEach((entity) =>
    next.set(entity.id, {
      ...entity,
      content: typeof entity.content === "string" ? entity.content : "",
      contentRevision: Number.isSafeInteger(entity.contentRevision) ? entity.contentRevision : 0,
      metadataRevision: Number.isSafeInteger(entity.metadataRevision) ? entity.metadataRevision : 0,
      lastContentMutationId: entity.lastContentMutationId || "",
      lastMetadataMutationId: entity.lastMetadataMutationId || "",
    }),
  );
  stores[storeName] = next;
}

export function initialize(data: DocumentData): void {
  contentAttempts.clear();
  metadataPending.clear();
  metadataQueues.clear();
  localGeneration = 0;
  replaceStore("memos", data.memos);
  replaceStore("projects", data.projects);
  replaceStore("cases", data.cases);
  replaceStore("tasks", data.tasks);
  emit({ entityType: "all", op: "initialize" });
}

export function applyServerData(data: DocumentData): void {
  replaceStore("memos", data.memos);
  replaceStore("projects", data.projects);
  replaceStore("cases", data.cases);
  replaceStore("tasks", data.tasks);
  emit({ entityType: "all", op: "serverRefresh" });
}

export function on(listener: Listener): void {
  listeners.add(listener);
}

export function off(listener: Listener): void {
  listeners.delete(listener);
}

export function get(storeName: DocumentStoreName, id: string): DocumentEntity | null {
  return stores[storeName].get(id) ?? null;
}

export function getAll(storeName: DocumentStoreName): DocumentEntity[] {
  return Array.from(stores[storeName].values());
}

export function getByIndex(
  storeName: DocumentStoreName,
  indexName: string,
  value: string,
): DocumentEntity[] {
  return getAll(storeName).filter((entity) => {
    const indexed = (entity as unknown as Record<string, unknown>)[indexName];
    return String(indexed ?? "") === value;
  });
}

export function putLocal(storeName: DocumentStoreName, entity: DocumentEntity): void {
  stores[storeName].set(entity.id, entity);
  localGeneration += 1;
  emit({ entityType: entityTypeFor(storeName), op: "localUpdate", id: entity.id, storeName });
}

export function updateLocal(
  storeName: DocumentStoreName,
  id: string,
  patch: Record<string, unknown>,
  op = "localUpdate",
): void {
  const current = get(storeName, id);
  if (!current) return;
  stores[storeName].set(id, { ...current, ...patch } as DocumentEntity);
  localGeneration += 1;
  emit({ entityType: entityTypeFor(storeName), op, id, storeName });
}

export function getLocalGeneration(): number {
  return localGeneration;
}

function parseContentMutationResult(value: unknown): ContentMutationResult {
  if (!value || typeof value !== "object") throw new Error("Invalid content mutation response");
  return value as ContentMutationResult;
}

function parseMetadataMutationResult(value: unknown): MetadataMutationResult {
  if (!value || typeof value !== "object") throw new Error("Invalid metadata mutation response");
  return value as MetadataMutationResult;
}

export async function saveContent(
  storeName: DocumentStoreName,
  id: string,
  content: string,
): Promise<ContentSnapshot> {
  const entity = get(storeName, id);
  if (!entity) throw new Error(`Document not found: ${documentKey(storeName, id)}`);
  const key = documentKey(storeName, id);
  const attempt = contentAttempts.get(key) ?? {
    content,
    expectedRevision: entity.contentRevision,
    mutationId: crypto.randomUUID(),
  };
  contentAttempts.set(key, attempt);
  const result = parseContentMutationResult(
    await serverCall("putDocumentContent", {
      documentKey: key,
      content: attempt.content,
      expectedRevision: attempt.expectedRevision,
      mutationId: attempt.mutationId,
    }),
  );
  if (result.status === "missing") {
    contentAttempts.delete(key);
    throw new Error("Document no longer exists on the server");
  }
  if (result.status === "conflict") {
    contentAttempts.delete(key);
    if (result.snapshot.content === attempt.content) {
      applyContentSnapshot(storeName, id, result.snapshot);
      return content === attempt.content ? result.snapshot : saveContent(storeName, id, content);
    }
    throw new DocumentContentConflictError(content, result.snapshot);
  }
  if (result.mutationId !== attempt.mutationId) {
    throw new Error("Mismatched content mutation response");
  }
  contentAttempts.delete(key);
  const latestEntity = get(storeName, id) ?? entity;

  updateLocal(
    storeName,
    id,
    {
      content: result.snapshot.content,
      contentRevision: result.snapshot.revision,
      lastContentMutationId: result.snapshot.lastMutationId,
      updatedAt: latestUpdatedAt(latestEntity.updatedAt, result.snapshot.updatedAt),
    },
    "contentSaved",
  );
  notifyContentConfirmed(storeName, id, result.snapshot);
  return content === attempt.content ? result.snapshot : saveContent(storeName, id, content);
}

export function applyContentSnapshot(
  storeName: DocumentStoreName,
  id: string,
  snapshot: ContentSnapshot,
): void {
  const current = get(storeName, id);
  if (!current) return;
  updateLocal(
    storeName,
    id,
    {
      content: snapshot.content,
      contentRevision: snapshot.revision,
      lastContentMutationId: snapshot.lastMutationId,
      updatedAt: latestUpdatedAt(current.updatedAt, snapshot.updatedAt),
    },
    "contentSnapshot",
  );
}

export function applyRemoteContentSnapshot(
  storeName: DocumentStoreName,
  id: string,
  snapshot: ContentSnapshot,
): void {
  const current = get(storeName, id);
  if (!current || snapshot.documentKey !== documentKey(storeName, id)) return;
  if (snapshot.revision <= current.contentRevision) return;
  updateLocal(
    storeName,
    id,
    {
      content: snapshot.content,
      contentRevision: snapshot.revision,
      lastContentMutationId: snapshot.lastMutationId,
      updatedAt: latestUpdatedAt(current.updatedAt, snapshot.updatedAt),
    },
    "remoteContentApplied",
  );
}

function applyMetadataSnapshot(
  storeName: DocumentStoreName,
  id: string,
  snapshot: MetadataSnapshot,
): void {
  const current = get(storeName, id);
  if (!current || snapshot.documentKey !== documentKey(storeName, id)) return;
  if (snapshot.revision < current.metadataRevision) return;
  updateLocal(
    storeName,
    id,
    {
      ...snapshot.metadata,
      metadataRevision: snapshot.revision,
      lastMetadataMutationId: snapshot.lastMutationId,
      updatedAt: latestUpdatedAt(current.updatedAt, snapshot.updatedAt),
    },
    "metadataSaved",
  );
}

function pendingMetadataOverlay(pending: PendingMetadata | undefined): Record<string, unknown> {
  if (!pending) return {};
  return { ...(pending.attempt?.patch ?? {}), ...pending.patch };
}

export function applyRemoteMetadataSnapshot(
  storeName: DocumentStoreName,
  id: string,
  snapshot: MetadataSnapshot,
): void {
  const current = get(storeName, id);
  if (!current || snapshot.documentKey !== documentKey(storeName, id)) return;
  if (snapshot.revision <= current.metadataRevision) return;
  applyMetadataSnapshot(storeName, id, snapshot);
  const pending = metadataPending.get(documentKey(storeName, id));
  if (pending) updateLocal(storeName, id, pendingMetadataOverlay(pending), "metadataPending");
}

export function patchMetadata(
  storeName: DocumentStoreName,
  id: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const key = documentKey(storeName, id);
  const pending = metadataPending.get(key);
  if (pending) {
    pending.patch = { ...pending.patch, ...patch };
  } else {
    metadataPending.set(key, { storeName, id, patch: { ...patch } });
  }
  return scheduleMetadataFlush(key);
}

async function flushMetadata(key: string): Promise<void> {
  let conflictCount = 0;
  while (metadataPending.has(key)) {
    const pending = metadataPending.get(key)!;
    const entity = get(pending.storeName, pending.id);
    if (!entity) throw new Error(`Document not found: ${key}`);
    let attempt = pending.attempt;
    if (!attempt) {
      attempt = {
        patch: { ...pending.patch },
        expectedRevision: entity.metadataRevision,
        mutationId: crypto.randomUUID(),
      };
      pending.patch = {};
      pending.attempt = attempt;
    }

    const result = parseMetadataMutationResult(
      await serverCall("patchDocumentMetadata", {
        documentKey: key,
        patch: attempt.patch,
        expectedRevision: attempt.expectedRevision,
        mutationId: attempt.mutationId,
      }),
    );
    if (result.status === "missing") throw new Error("Document no longer exists on the server");
    if (result.status === "rejected") throw new Error(result.reason);
    if (result.status === "conflict") {
      applyMetadataSnapshot(pending.storeName, pending.id, result.snapshot);
      pending.patch = { ...attempt.patch, ...pending.patch };
      pending.attempt = undefined;
      updateLocal(
        pending.storeName,
        pending.id,
        pendingMetadataOverlay(pending),
        "metadataPending",
      );
      conflictCount += 1;
      if (conflictCount >= 10) {
        throw new DocumentMetadataConflictError(result.snapshot);
      }
      continue;
    }
    if (result.mutationId !== attempt.mutationId) {
      throw new Error("Mismatched metadata mutation response");
    }
    applyMetadataSnapshot(pending.storeName, pending.id, result.snapshot);
    notifyMetadataConfirmed(pending.storeName, pending.id, result.snapshot);
    const latest = metadataPending.get(key);
    if (!latest) {
      continue;
    }
    latest.attempt = undefined;
    if (Object.keys(latest.patch).length === 0) {
      metadataPending.delete(key);
      emit({
        entityType: entityTypeFor(pending.storeName),
        op: "metadataSettled",
        id: pending.id,
      });
    } else {
      updateLocal(latest.storeName, latest.id, pendingMetadataOverlay(latest), "metadataPending");
    }
  }
}

function scheduleMetadataFlush(key: string): Promise<void> {
  const existing = metadataQueues.get(key);
  if (existing) return existing;
  const pending = metadataPending.get(key);
  if (pending) {
    emit({ entityType: entityTypeFor(pending.storeName), op: "metadataPending", id: pending.id });
  }
  const operation = flushMetadata(key).catch((error) => {
    const failed = metadataPending.get(key);
    if (failed) {
      emit({ entityType: entityTypeFor(failed.storeName), op: "metadataError", id: failed.id });
    }
    throw error;
  });
  metadataQueues.set(key, operation);
  const cleanup = () => {
    if (metadataQueues.get(key) === operation) metadataQueues.delete(key);
  };
  void operation.then(cleanup, cleanup);
  return operation;
}

export async function waitForMetadata(storeName: DocumentStoreName, id: string): Promise<void> {
  const key = documentKey(storeName, id);
  const operation =
    metadataQueues.get(key) ?? (metadataPending.has(key) ? scheduleMetadataFlush(key) : undefined);
  await operation;
}

export async function waitForAllMetadata(): Promise<void> {
  const operations = Array.from(metadataPending.keys()).map((key) => scheduleMetadataFlush(key));
  await Promise.all(operations);
}

export function hasPendingMetadata(storeName: DocumentStoreName, id: string): boolean {
  return metadataPending.has(documentKey(storeName, id));
}

export function hasAnyPendingMetadata(): boolean {
  return metadataPending.size > 0;
}

export function reorderLocal(storeName: DocumentStoreName, orderedIds: string[]): void {
  orderedIds.forEach((id, index) =>
    updateLocal(storeName, id, { sortOrder: index + 1 }, "reorder"),
  );
}
