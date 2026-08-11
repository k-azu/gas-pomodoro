import { acceptCommittedDocument } from "./documentCoordinator";
import { toDocumentKey } from "./documentRepository";

export interface ContentConflictSnapshot {
  content: string;
  revision: number;
  updatedAt: string;
}

export interface ContentSaveOptions {
  immediateSync?: boolean;
  resolveConflict?: boolean;
  baseRevision?: number;
  mutationId?: string;
}

export type ResolveDocument = (
  id: string,
) => Promise<{ useServer: boolean; content?: string; revision?: number } | null>;

const resolvedDocuments = new Set<string>();
const resolvingDocuments = new Map<
  string,
  Promise<{ useServer: boolean; content?: string; revision?: number } | null>
>();

export const documentKey = (scope: string, id: string | undefined) => `${scope}:${id ?? ""}`;

export function getResolveStatus(scope: string, id: string): "resolving" | "synced" | undefined {
  const key = documentKey(scope, id);
  if (resolvingDocuments.has(key)) return "resolving";
  return resolvedDocuments.has(key) ? "synced" : undefined;
}

export function invalidateResolveStatus(scope: string, id: string): void {
  resolvedDocuments.delete(documentKey(scope, id));
}

/** Resolve once per document in this page session and share the in-flight Promise. */
export function ensureDocumentResolved(
  scope: string,
  id: string,
  resolveContent: ResolveDocument,
): Promise<{ useServer: boolean; content?: string; revision?: number } | null> {
  const key = documentKey(scope, id);
  if (resolvedDocuments.has(key)) return Promise.resolve(null);
  const existing = resolvingDocuments.get(key);
  if (existing) return existing;
  const resolving = resolveContent(id)
    .then((result) => {
      resolvedDocuments.add(key);
      return result;
    })
    .finally(() => {
      resolvingDocuments.delete(key);
    });
  resolvingDocuments.set(key, resolving);
  return resolving;
}

export function acceptCommittedContent(
  scope: string,
  id: string,
  content: string,
  revision: number,
  updatedAt: string,
) {
  return acceptCommittedDocument(scope, id, {
    key: toDocumentKey(scope, id),
    content,
    revision,
    updatedAt,
  });
}
