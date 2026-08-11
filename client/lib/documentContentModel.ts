export interface CommittedDocumentBody {
  key: string;
  content: string;
  revision: number;
  updatedAt: string;
  /** Present only when this page persisted the server mutation that produced the revision. */
  mutationId?: string;
}

interface DraftBase {
  key: string;
  localVersion: number;
  updatedAt: string;
}

export interface PendingDocumentDraft extends DraftBase {
  kind: "pending";
  content: string;
  baseRevision: number;
  mutationId: string;
}

export interface ConflictingDocumentDraft extends DraftBase {
  kind: "conflict";
  localContent: string;
  remote: CommittedDocumentBody;
}

export type ActiveDocumentDraft = PendingDocumentDraft | ConflictingDocumentDraft;

export interface RecoveryDocumentDraft {
  recoveryId: string;
  documentKey: string;
  content: string;
  createdAt: string;
  reason: "inactive" | "notFound" | "superseded";
}

export interface DocumentContentState {
  committed: CommittedDocumentBody;
  draft: ActiveDocumentDraft | null;
}

export interface DocumentContentReadModel {
  content: string;
  revision: number;
  source: "committed" | "draft";
  versionToken: string;
  mutationId?: string;
  conflict?: CommittedDocumentBody;
}

export interface EditDocumentEvent {
  content: string;
  baseRevision: number;
  allowRebase: boolean;
  localVersion: number;
  mutationId: string;
  updatedAt: string;
}

export interface SaveAcceptedEvent {
  requestMutationId: string;
  content: string;
  revision: number;
  updatedAt: string;
}

export interface RemoteDocumentEvent {
  content: string;
  revision: number;
  updatedAt: string;
}

export interface TerminalRejectionEvent {
  reason: "inactive" | "notFound";
  recoveryId: string;
  createdAt: string;
}

function committedFromRemote(
  current: CommittedDocumentBody,
  remote: RemoteDocumentEvent,
  mutationId?: string,
): CommittedDocumentBody {
  if (remote.revision <= current.revision) return current;
  return { key: current.key, ...remote, ...(mutationId ? { mutationId } : {}) };
}

function draftContent(draft: ActiveDocumentDraft): string {
  return draft.kind === "pending" ? draft.content : draft.localContent;
}

export function selectDocumentContent(state: DocumentContentState): DocumentContentReadModel {
  const { committed, draft } = state;
  if (!draft) {
    return {
      content: committed.content,
      revision: committed.revision,
      source: "committed",
      versionToken: `committed:${committed.revision}`,
    };
  }
  if (draft.kind === "pending") {
    return {
      content: draft.content,
      revision: draft.baseRevision,
      source: "draft",
      versionToken: `pending:${draft.localVersion}:${draft.mutationId}:${draft.baseRevision}`,
      mutationId: draft.mutationId,
    };
  }
  return {
    content: draft.localContent,
    revision: draft.remote.revision,
    source: "draft",
    versionToken: `conflict:${draft.localVersion}:${draft.remote.revision}`,
    conflict: draft.remote,
  };
}

export function editDocument(
  state: DocumentContentState,
  event: EditDocumentEvent,
): DocumentContentState {
  if (state.draft?.kind === "conflict") {
    return {
      ...state,
      draft: {
        ...state.draft,
        localContent: event.content,
        localVersion: event.localVersion,
        updatedAt: event.updatedAt,
      },
    };
  }
  if (event.content === state.committed.content) {
    return { committed: state.committed, draft: null };
  }
  if (event.baseRevision !== state.committed.revision && !event.allowRebase) {
    return {
      committed: state.committed,
      draft: {
        kind: "conflict",
        key: state.committed.key,
        localContent: event.content,
        remote: state.committed,
        localVersion: event.localVersion,
        updatedAt: event.updatedAt,
      },
    };
  }
  return {
    ...state,
    draft: {
      kind: "pending",
      key: state.committed.key,
      content: event.content,
      baseRevision: state.committed.revision,
      mutationId: event.mutationId,
      localVersion: event.localVersion,
      updatedAt: event.updatedAt,
    },
  };
}

export function applySaveAccepted(
  state: DocumentContentState,
  event: SaveAcceptedEvent,
): DocumentContentState {
  if (event.revision < state.committed.revision) return state;
  const committed = committedFromRemote(state.committed, event, event.requestMutationId);
  const draft = state.draft;
  if (!draft || draft.kind !== "pending") return { committed, draft };
  if (draft.mutationId === event.requestMutationId) return { committed, draft: null };
  return {
    committed,
    draft: {
      ...draft,
      baseRevision: committed.revision,
    },
  };
}

export function applyRemoteDocument(
  state: DocumentContentState,
  event: RemoteDocumentEvent,
): DocumentContentState {
  const committed = committedFromRemote(state.committed, event);
  if (committed === state.committed) return state;
  const draft = state.draft;
  if (!draft) return { committed, draft: null };
  const localContent = draftContent(draft);
  if (localContent === committed.content) return { committed, draft: null };
  return {
    committed,
    draft: {
      kind: "conflict",
      key: committed.key,
      localContent,
      remote: committed,
      localVersion: draft.localVersion,
      updatedAt: draft.updatedAt,
    },
  };
}

export function keepLocalDocument(
  state: DocumentContentState,
  mutationId: string,
  updatedAt: string,
): DocumentContentState {
  if (state.draft?.kind !== "conflict") return state;
  return {
    ...state,
    draft: {
      kind: "pending",
      key: state.committed.key,
      content: state.draft.localContent,
      baseRevision: state.draft.remote.revision,
      mutationId,
      localVersion: state.draft.localVersion,
      updatedAt,
    },
  };
}

export function acceptRemoteDocument(
  state: DocumentContentState,
  expectedRevision?: number,
): DocumentContentState {
  if (state.draft?.kind !== "conflict") return state;
  if (expectedRevision !== undefined && state.draft.remote.revision !== expectedRevision) {
    return state;
  }
  return { committed: state.draft.remote, draft: null };
}

export function rejectDocumentDraft(
  state: DocumentContentState,
  event: TerminalRejectionEvent,
): { state: DocumentContentState; recovery: RecoveryDocumentDraft | null } {
  if (!state.draft) return { state, recovery: null };
  return {
    state: { ...state, draft: null },
    recovery: {
      recoveryId: event.recoveryId,
      documentKey: state.committed.key,
      content: draftContent(state.draft),
      createdAt: event.createdAt,
      reason: event.reason,
    },
  };
}
