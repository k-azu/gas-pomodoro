export interface DocumentSyncErrorEvent {
  storeName: string;
  id: string;
  error: unknown;
  /** Draft generation that failed. Omitted only for failures not tied to a draft. */
  mutationId?: string;
  /** Terminal rejections remain visible after the Active Draft moves to Recovery. */
  terminal?: boolean;
}

type Listener = (event: DocumentSyncErrorEvent) => void;

const listeners = new Set<Listener>();
const errors = new Map<string, DocumentSyncErrorEvent>();

function errorKey(storeName: string, id: string): string {
  return `${storeName}:${id}`;
}

export function publishDocumentSyncError(event: DocumentSyncErrorEvent): void {
  errors.set(errorKey(event.storeName, event.id), event);
  listeners.forEach((listener) => listener(event));
}

export function clearDocumentSyncError(storeName: string, id: string): void {
  errors.delete(errorKey(storeName, id));
}

export function getDocumentSyncError(
  storeName: string,
  id: string,
): DocumentSyncErrorEvent | undefined {
  return errors.get(errorKey(storeName, id));
}

export function isDocumentSyncErrorCurrent(
  event: DocumentSyncErrorEvent,
  snapshot: { source: "committed" | "draft"; mutationId?: string },
): boolean {
  if (event.terminal) return true;
  return (
    snapshot.source === "draft" &&
    (event.mutationId === undefined || event.mutationId === snapshot.mutationId)
  );
}

export function subscribeDocumentSyncError(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
