import * as EntityStore from "./entityStore";
import { onDocumentCommit, type DocumentCommitMessage } from "./tabSync";

export type ContentSnapshot = EntityStore.ContentSnapshot;
export type ContentConflictSnapshot = EntityStore.ContentConflictSnapshot;
export type ContentSaveOptions = EntityStore.ContentSaveOptions;

export interface ContentResolvedEvent {
  storeName?: string;
  id: string;
  content: string;
  revision?: number;
}

export interface ResolveCompleteEvent {
  scope?: string;
  id: string;
  revision?: number;
}

export interface ResolveErrorEvent {
  scope?: string;
  id: string;
}

export interface ContentCommittedEvent {
  storeName: string;
  id: string;
  content: string;
  revision: number;
  updatedAt: string;
  mutationId: string;
}

export interface ContentConflictEvent {
  storeName: string;
  id: string;
  content: string;
  revision: number;
  updatedAt: string;
}

export interface DocumentSyncHandlers {
  contentResolved?: (event: ContentResolvedEvent) => void;
  resolveComplete?: (event: ResolveCompleteEvent) => void;
  resolveError?: (event: ResolveErrorEvent) => void;
  contentCommitted?: (event: ContentCommittedEvent) => void;
  contentConflict?: (event: ContentConflictEvent) => void;
  tabCommit?: (event: DocumentCommitMessage) => void;
}

export type ResolveDocument = (
  id: string,
) => Promise<{ useServer: boolean; content?: string; revision?: number } | null>;

const resolveStatus = new Map<string, "resolving" | "synced">();

export const documentKey = (scope: string, id: string | undefined) => `${scope}:${id ?? ""}`;

export function getResolveStatus(scope: string, id: string): "resolving" | "synced" | undefined {
  return resolveStatus.get(documentKey(scope, id));
}

export function invalidateResolveStatus(scope: string, id: string): void {
  resolveStatus.delete(documentKey(scope, id));
}

/** Resolve once per document in this page session; results are delivered as typed events. */
export function ensureDocumentResolved(
  scope: string,
  id: string,
  resolveContent: ResolveDocument,
): void {
  const key = documentKey(scope, id);
  if (resolveStatus.has(key)) return;
  resolveStatus.set(key, "resolving");
  resolveContent(id)
    .then((result) => {
      resolveStatus.set(key, "synced");
      EntityStore.emit("resolveComplete", { scope, id, revision: result?.revision });
    })
    .catch(() => {
      resolveStatus.delete(key);
      EntityStore.emit("resolveError", { scope, id });
    });
}

export function subscribeDocumentSync(handlers: DocumentSyncHandlers): () => void {
  const subscriptions: Array<[string, (event: any) => void]> = [];
  const subscribe = (event: string, handler: ((event: any) => void) | undefined) => {
    if (!handler) return;
    EntityStore.on(event, handler);
    subscriptions.push([event, handler]);
  };

  subscribe("contentResolved", handlers.contentResolved);
  subscribe("resolveComplete", handlers.resolveComplete);
  subscribe("resolveError", handlers.resolveError);
  subscribe("contentCommitted", handlers.contentCommitted);
  subscribe("contentConflict", handlers.contentConflict);
  const unsubscribeTabCommit = handlers.tabCommit
    ? onDocumentCommit(handlers.tabCommit)
    : () => undefined;

  return () => {
    subscriptions.forEach(([event, handler]) => EntityStore.off(event, handler));
    unsubscribeTabCommit();
  };
}

export function getCommittedContentSnapshot(scope: string, id: string) {
  return EntityStore.getCommittedContentSnapshot(scope, id);
}

export function acceptCommittedContent(
  scope: string,
  id: string,
  content: string,
  revision: number,
  updatedAt: string,
) {
  return EntityStore.acceptCommittedContent(scope, id, content, revision, updatedAt);
}
