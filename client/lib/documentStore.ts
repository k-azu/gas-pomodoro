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

interface MetadataSnapshot {
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

type DocumentEvent = {
  entityType: "memo" | "project" | "case" | "task" | "all";
  op: string;
  id?: string;
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
const metadataPending = new Map<
  string,
  {
    storeName: DocumentStoreName;
    id: string;
    patch: Record<string, unknown>;
    version: number;
    attempt?: {
      patch: Record<string, unknown>;
      version: number;
      expectedRevision: number;
      mutationId: string;
    };
  }
>();
const channelSource = crypto.randomUUID();
const syncChannel =
  typeof window === "undefined" || typeof BroadcastChannel === "undefined"
    ? null
    : new BroadcastChannel("gas-pomodoro:document-confirmed:v1");

syncChannel?.addEventListener("message", (event: MessageEvent) => {
  const message = event.data as { source?: string; type?: string } | null;
  if (!message || message.source === channelSource || message.type !== "document-confirmed") {
    return;
  }
  emit({ entityType: "all", op: "remoteInvalidation" });
});

function documentKey(storeName: DocumentStoreName, id: string): string {
  return `${storeName}:${id}`;
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

export function notifyServerConfirmed(): void {
  syncChannel?.postMessage({ source: channelSource, type: "document-confirmed" });
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
  replaceStore(
    "tasks",
    data.tasks.map((task) => {
      const current = get("tasks", task.id) as Task | null;
      return {
        ...task,
        _cachedTimeSeconds: task._cachedTimeSeconds ?? current?._cachedTimeSeconds,
        _cachedPomodoroCount: task._cachedPomodoroCount ?? current?._cachedPomodoroCount,
      };
    }),
  );
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
  emit({ entityType: entityTypeFor(storeName), op: "localUpdate", id: entity.id });
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
  emit({ entityType: entityTypeFor(storeName), op, id });
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

  updateLocal(
    storeName,
    id,
    {
      content: result.snapshot.content,
      contentRevision: result.snapshot.revision,
      lastContentMutationId: result.snapshot.lastMutationId,
      updatedAt: result.snapshot.updatedAt,
    },
    "contentSaved",
  );
  notifyServerConfirmed();
  return content === attempt.content ? result.snapshot : saveContent(storeName, id, content);
}

export function applyContentSnapshot(
  storeName: DocumentStoreName,
  id: string,
  snapshot: ContentSnapshot,
): void {
  updateLocal(
    storeName,
    id,
    {
      content: snapshot.content,
      contentRevision: snapshot.revision,
      lastContentMutationId: snapshot.lastMutationId,
      updatedAt: snapshot.updatedAt,
    },
    "contentSnapshot",
  );
}

function applyMetadataSnapshot(
  storeName: DocumentStoreName,
  id: string,
  snapshot: MetadataSnapshot,
): void {
  updateLocal(
    storeName,
    id,
    {
      ...snapshot.metadata,
      metadataRevision: snapshot.revision,
      lastMetadataMutationId: snapshot.lastMutationId,
      updatedAt: snapshot.updatedAt,
    },
    "metadataSaved",
  );
}

export function patchMetadata(
  storeName: DocumentStoreName,
  id: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const key = documentKey(storeName, id);
  const pending = metadataPending.get(key);
  metadataPending.set(key, {
    storeName,
    id,
    patch: { ...(pending?.patch ?? {}), ...patch },
    version: (pending?.version ?? 0) + 1,
    attempt: pending?.attempt,
  });
  return scheduleMetadataFlush(key);
}

async function flushMetadata(key: string): Promise<void> {
  let conflictCount = 0;
  while (metadataPending.has(key)) {
    const pending = metadataPending.get(key)!;
    const entity = get(pending.storeName, pending.id);
    if (!entity) throw new Error(`Document not found: ${key}`);
    const attempt = pending.attempt ?? {
      patch: { ...pending.patch },
      version: pending.version,
      expectedRevision: entity.metadataRevision,
      mutationId: crypto.randomUUID(),
    };
    pending.attempt = attempt;

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
      conflictCount += 1;
      if (conflictCount >= 10) {
        throw new DocumentMetadataConflictError(result.snapshot);
      }
      pending.attempt = undefined;
      updateLocal(pending.storeName, pending.id, pending.patch, "metadataPending");
      continue;
    }
    if (result.mutationId !== attempt.mutationId) {
      throw new Error("Mismatched metadata mutation response");
    }
    applyMetadataSnapshot(pending.storeName, pending.id, result.snapshot);
    notifyServerConfirmed();
    const latest = metadataPending.get(key);
    if (!latest || latest.version === attempt.version) {
      metadataPending.delete(key);
      emit({
        entityType: entityTypeFor(pending.storeName),
        op: "metadataSettled",
        id: pending.id,
      });
    } else {
      latest.attempt = undefined;
      updateLocal(latest.storeName, latest.id, latest.patch, "metadataPending");
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
