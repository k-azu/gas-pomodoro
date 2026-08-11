import type { ContentConflictSnapshot } from "./documentSync";

export type DocumentPhase = "loading" | "resolving" | "editable" | "blocked";

export type DocumentErrorReason = "load" | "resolve" | "transform" | "save";

export type ConflictResolution = "accepting-remote" | "keeping-local";

export type DocumentSyncState =
  | { kind: "clean" }
  | { kind: "dirty" }
  | { kind: "saving" }
  | {
      kind: "conflict";
      remote: ContentConflictSnapshot;
      resolution?: ConflictResolution;
      error?: "transform" | "save";
    }
  | {
      kind: "error";
      reason: DocumentErrorReason;
      hasLocalChanges: boolean;
    };

export interface DocumentSessionState {
  phase: DocumentPhase;
  sync: DocumentSyncState;
}

export type DocumentSessionEvent =
  | { type: "documentOpened"; needsResolve: boolean }
  | {
      type: "localSnapshotLoaded";
      dirty: boolean;
      conflict?: ContentConflictSnapshot;
    }
  | { type: "resolveSucceeded" }
  | { type: "localEdited" }
  | { type: "saveStarted" }
  | { type: "remoteConflictDetected"; remote: ContentConflictSnapshot }
  | { type: "conflictResolutionStarted"; choice: "remote" | "local" }
  | {
      type: "operationFailed";
      reason: DocumentErrorReason;
      hasLocalChanges: boolean;
    };

export const initialDocumentSessionState: DocumentSessionState = {
  phase: "loading",
  sync: { kind: "clean" },
};

export function documentSessionReducer(
  state: DocumentSessionState,
  event: DocumentSessionEvent,
): DocumentSessionState {
  switch (event.type) {
    case "documentOpened":
      return {
        phase: event.needsResolve ? "resolving" : "loading",
        sync: { kind: "clean" },
      };
    case "localSnapshotLoaded":
      return {
        phase: state.phase === "resolving" ? "resolving" : "editable",
        sync: event.conflict
          ? { kind: "conflict", remote: event.conflict }
          : event.dirty
            ? { kind: "dirty" }
            : { kind: "clean" },
      };
    case "resolveSucceeded":
      return { ...state, phase: "editable" };
    case "localEdited":
      return state.sync.kind === "conflict"
        ? { ...state, sync: { ...state.sync, error: undefined } }
        : { ...state, sync: { kind: "dirty" } };
    case "saveStarted":
      return state.sync.kind === "conflict" ? state : { ...state, sync: { kind: "saving" } };
    case "remoteConflictDetected":
      return {
        ...state,
        sync: { kind: "conflict", remote: event.remote },
      };
    case "conflictResolutionStarted":
      if (state.sync.kind !== "conflict") return state;
      return {
        ...state,
        sync: {
          kind: "conflict",
          remote: state.sync.remote,
          resolution: event.choice === "remote" ? "accepting-remote" : "keeping-local",
        },
      };
    case "operationFailed":
      if (state.sync.kind === "conflict") {
        return {
          ...state,
          phase:
            event.reason === "load"
              ? "blocked"
              : event.reason === "resolve" || event.reason === "transform"
                ? "editable"
                : state.phase,
          sync: {
            kind: "conflict",
            remote: state.sync.remote,
            ...(event.reason === "transform" || event.reason === "save"
              ? { error: event.reason }
              : {}),
          },
        };
      }
      return {
        phase:
          event.reason === "load"
            ? "blocked"
            : event.reason === "resolve" || event.reason === "transform"
              ? "editable"
              : state.phase,
        sync: {
          kind: "error",
          reason: event.reason,
          hasLocalChanges: event.hasLocalChanges,
        },
      };
  }
}

export function isDocumentReadOnly(state: DocumentSessionState): boolean {
  return state.phase !== "editable";
}

export type DocumentSyncStatus = "idle" | "syncing" | "conflict" | "error";

export function getDocumentSyncStatus(state: DocumentSessionState): DocumentSyncStatus {
  if (state.phase === "resolving") return "syncing";
  switch (state.sync.kind) {
    case "clean":
    case "dirty":
      return "idle";
    case "saving":
      return "syncing";
    case "conflict":
      return state.sync.resolution ? "syncing" : "conflict";
    case "error":
      return "error";
  }
}

export function getDocumentConflict(state: DocumentSessionState): ContentConflictSnapshot | null {
  return state.sync.kind === "conflict" ? state.sync.remote : null;
}
