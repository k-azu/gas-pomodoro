export interface DocumentSyncErrorEvent {
  storeName: string;
  id: string;
  error: unknown;
}

type Listener = (event: DocumentSyncErrorEvent) => void;

const listeners = new Set<Listener>();
const errors = new Map<string, unknown>();

function errorKey(storeName: string, id: string): string {
  return `${storeName}:${id}`;
}

export function publishDocumentSyncError(event: DocumentSyncErrorEvent): void {
  errors.set(errorKey(event.storeName, event.id), event.error);
  listeners.forEach((listener) => listener(event));
}

export function clearDocumentSyncError(storeName: string, id: string): void {
  errors.delete(errorKey(storeName, id));
}

export function getDocumentSyncError(storeName: string, id: string): unknown | undefined {
  return errors.get(errorKey(storeName, id));
}

export function subscribeDocumentSyncError(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
