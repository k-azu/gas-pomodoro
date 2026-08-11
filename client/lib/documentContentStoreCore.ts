import type { DocumentContentReadModel } from "./documentContentModel";

export type DocumentContentLoader = (
  storeName: string,
  id: string,
) => Promise<DocumentContentReadModel | null>;

export type DocumentContentListener = (snapshot: DocumentContentReadModel | null) => void;

interface DocumentContentEntry {
  storeName: string;
  id: string;
  snapshot: DocumentContentReadModel | null | undefined;
  listeners: Set<DocumentContentListener>;
  loading: Promise<DocumentContentReadModel | null> | null;
  stale: boolean;
}

function entryKey(storeName: string, id: string): string {
  return `${storeName}:${id}`;
}

function sameSnapshot(
  left: DocumentContentReadModel | null | undefined,
  right: DocumentContentReadModel | null,
): boolean {
  if (left === undefined) return false;
  if (left === null || right === null) return left === right;
  return left.versionToken === right.versionToken;
}

/** Coalesces invalidations into canonical reads without dropping in-flight updates. */
export class DocumentContentStore {
  private readonly entries = new Map<string, DocumentContentEntry>();

  constructor(private readonly load: DocumentContentLoader) {}

  private entry(storeName: string, id: string): DocumentContentEntry {
    const key = entryKey(storeName, id);
    let entry = this.entries.get(key);
    if (!entry) {
      entry = {
        storeName,
        id,
        snapshot: undefined,
        listeners: new Set(),
        loading: null,
        stale: false,
      };
      this.entries.set(key, entry);
    }
    return entry;
  }

  getSnapshot(storeName: string, id: string): DocumentContentReadModel | null | undefined {
    return this.entries.get(entryKey(storeName, id))?.snapshot;
  }

  subscribe(storeName: string, id: string, listener: DocumentContentListener): () => void {
    const entry = this.entry(storeName, id);
    entry.listeners.add(listener);
    return () => entry.listeners.delete(listener);
  }

  invalidate(storeName: string, id: string): void {
    const entry = this.entries.get(entryKey(storeName, id));
    if (!entry) return;
    entry.stale = true;
    if (!entry.loading) {
      void this.refresh(storeName, id).catch((error) => {
        console.error("[DocumentContentStore] Failed to refresh invalidated document:", error);
      });
    }
  }

  refresh(storeName: string, id: string): Promise<DocumentContentReadModel | null> {
    const entry = this.entry(storeName, id);
    if (entry.loading) {
      entry.stale = true;
      return entry.loading;
    }

    const loading = (async () => {
      let snapshot: DocumentContentReadModel | null;
      do {
        entry.stale = false;
        snapshot = await this.load(storeName, id);
      } while (entry.stale);

      if (!sameSnapshot(entry.snapshot, snapshot)) {
        entry.snapshot = snapshot;
        entry.listeners.forEach((listener) => listener(snapshot));
      } else {
        entry.snapshot = snapshot;
      }
      return snapshot;
    })();

    entry.loading = loading;
    const clearLoading = () => {
      if (entry.loading === loading) entry.loading = null;
    };
    void loading.then(clearLoading, clearLoading);
    return loading;
  }
}
