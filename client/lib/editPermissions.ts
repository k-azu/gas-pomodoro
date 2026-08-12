import { supportsWebLocks } from "./webLocks";

export interface MetadataPermissionContext {
  activeDocumentKey?: string;
  activeDocumentReadOnly?: boolean;
}

export interface MetadataPermissionState extends MetadataPermissionContext {
  metadataReadOnly: boolean;
}

export class MetadataMutationUnsupportedError extends Error {
  constructor() {
    super("Metadata mutations require Web Locks support");
    this.name = "MetadataMutationUnsupportedError";
  }
}

/**
 * Web Locks support is a page-wide prerequisite for user-initiated metadata
 * mutations. Internal server reconciliation uses a separate path and is not
 * governed by this policy.
 */
export function isMetadataReadOnly(): boolean {
  return !supportsWebLocks();
}

/**
 * A non-active entity can safely use its own short-lived metadata lock. The
 * active document additionally follows its editor lease so that document-owned
 * fields remain consistently read-only while another tab owns it. Collection
 * order is synchronized separately as a latest-value collection state.
 */
export function canMutateMetadata(
  targetDocumentKey: string | undefined,
  context: MetadataPermissionContext = {},
): boolean {
  return evaluateMetadataMutation(targetDocumentKey, {
    ...context,
    metadataReadOnly: isMetadataReadOnly(),
  });
}

export function evaluateMetadataMutation(
  targetDocumentKey: string | undefined,
  state: MetadataPermissionState,
): boolean {
  if (state.metadataReadOnly) return false;
  if (!targetDocumentKey || targetDocumentKey !== state.activeDocumentKey) return true;
  return !state.activeDocumentReadOnly;
}

/** Store-level safety net for user mutation APIs. */
export function requireMetadataMutationSupport(): void {
  if (isMetadataReadOnly()) throw new MetadataMutationUnsupportedError();
}
