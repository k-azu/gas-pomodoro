import { useReducer } from "react";
import type { SyncStatus } from "../components/shared/SyncIndicator";
import type { ContentConflictSnapshot } from "../lib/documentSync";

interface DocumentSessionState {
  syncStatus: SyncStatus;
  readOnly: boolean;
  conflict: ContentConflictSnapshot | null;
}

type DocumentSessionAction =
  | { type: "ready" }
  | { type: "editable" }
  | { type: "loading" }
  | { type: "resolving" }
  | { type: "resolveComplete" }
  | { type: "resolveError" }
  | { type: "syncError" }
  | { type: "loadError" }
  | { type: "transformError" }
  | { type: "restoreConflict"; conflict?: ContentConflictSnapshot }
  | { type: "conflict"; conflict: ContentConflictSnapshot }
  | { type: "syncing" }
  | { type: "synced" }
  | { type: "settleSynced" }
  | { type: "idle" }
  | { type: "clearConflict" };

const initialState: DocumentSessionState = {
  syncStatus: "idle",
  readOnly: false,
  conflict: null,
};

function reducer(state: DocumentSessionState, action: DocumentSessionAction): DocumentSessionState {
  switch (action.type) {
    case "ready":
      return { syncStatus: "idle", readOnly: false, conflict: null };
    case "editable":
      return { ...state, readOnly: false };
    case "loading":
      return { ...state, readOnly: true };
    case "resolving":
      return { ...state, syncStatus: "syncing", readOnly: true };
    case "resolveComplete":
      return {
        ...state,
        syncStatus: state.syncStatus === "syncing" ? "synced" : state.syncStatus,
        readOnly: false,
      };
    case "resolveError":
      return { ...state, syncStatus: "error", readOnly: false };
    case "syncError":
      return { ...state, syncStatus: "error" };
    case "loadError":
      return { ...state, syncStatus: "error", readOnly: true };
    case "transformError":
      return { ...state, syncStatus: "error", readOnly: false };
    case "restoreConflict":
      return action.conflict
        ? { ...state, syncStatus: "conflict", conflict: action.conflict }
        : { ...state, conflict: null };
    case "conflict":
      return { ...state, syncStatus: "conflict", conflict: action.conflict };
    case "syncing":
      return { ...state, syncStatus: "syncing" };
    case "synced":
      return { ...state, syncStatus: "synced", conflict: null };
    case "settleSynced":
      return state.syncStatus === "synced" ? { ...state, syncStatus: "idle" } : state;
    case "idle":
      return { ...state, syncStatus: "idle" };
    case "clearConflict":
      return { ...state, conflict: null };
  }
}

export function useDocumentSession() {
  return useReducer(reducer, initialState);
}
