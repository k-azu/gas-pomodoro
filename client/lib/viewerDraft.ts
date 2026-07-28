import type { ViewerState } from "../contexts/NavigationContext";

const DRAFT_PREFIX = "gas_pomodoro_viewer_draft:";
const ACTIVE_DRAFT_KEY = "gas_pomodoro_active_viewer_draft";

export interface ViewerDraftFields {
  markdown: string;
  category: string;
  interruptionType: "work" | "nonWork" | null;
  startTime: string;
  endTime: string;
  projectId: string | null;
  caseId: string | null;
  taskId: string | null;
}

export interface ViewerDraft {
  identity: string;
  source: ViewerState;
  fields: ViewerDraftFields;
  updatedAt: string;
}

export function getViewerIdentity(state: ViewerState): string | null {
  const id = state.recordId || state.draftId;
  if (!id) return null;
  return `${state.recordType || "memory"}:${id}`;
}

function storageKey(identity: string): string {
  return `${DRAFT_PREFIX}${identity}`;
}

export function loadViewerDraft(identity: string): ViewerDraft | null {
  try {
    const raw = localStorage.getItem(storageKey(identity));
    if (!raw) return null;
    const draft = JSON.parse(raw) as ViewerDraft;
    return draft.identity === identity ? draft : null;
  } catch {
    return null;
  }
}

export function saveViewerDraft(draft: ViewerDraft): void {
  try {
    localStorage.setItem(storageKey(draft.identity), JSON.stringify(draft));
    sessionStorage.setItem(ACTIVE_DRAFT_KEY, draft.identity);
  } catch {
    // Storage may be unavailable or full. The beforeunload guard still warns.
  }
}

export function removeViewerDraft(identity: string): void {
  try {
    localStorage.removeItem(storageKey(identity));
    if (sessionStorage.getItem(ACTIVE_DRAFT_KEY) === identity) {
      sessionStorage.removeItem(ACTIVE_DRAFT_KEY);
    }
  } catch {
    // ignore
  }
}

export function clearActiveViewerDraft(identity?: string): void {
  try {
    if (!identity || sessionStorage.getItem(ACTIVE_DRAFT_KEY) === identity) {
      sessionStorage.removeItem(ACTIVE_DRAFT_KEY);
    }
  } catch {
    // ignore
  }
}

export function loadActiveViewerDraft(): ViewerDraft | null {
  try {
    const identity = sessionStorage.getItem(ACTIVE_DRAFT_KEY);
    const draft = identity ? loadViewerDraft(identity) : null;
    // In-memory interruption callbacks cannot be reconstructed after reload.
    return draft?.source.recordId ? draft : null;
  } catch {
    return null;
  }
}
