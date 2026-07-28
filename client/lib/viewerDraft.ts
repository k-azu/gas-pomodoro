import type { ViewerState } from "../contexts/NavigationContext";

const DRAFT_PREFIX = "gas_pomodoro_viewer_draft:";
export const ACTIVE_VIEWER_KEY = "gas_pomodoro_active_viewer";
const LEGACY_ACTIVE_DRAFT_KEY = "gas_pomodoro_active_viewer_draft";
const ACTIVE_VIEWER_TTL_MS = 7 * 24 * 60 * 60 * 1000;

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
  dirty: boolean;
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
    if (draft.identity !== identity) return null;
    // Drafts written before the active-viewer snapshot existed were always dirty.
    return { ...draft, dirty: draft.dirty ?? true };
  } catch {
    return null;
  }
}

export function saveViewerDraft(draft: ViewerDraft): boolean {
  try {
    const dirtyDraft = { ...draft, dirty: true };
    localStorage.setItem(storageKey(draft.identity), JSON.stringify(dirtyDraft));
    localStorage.setItem(ACTIVE_VIEWER_KEY, JSON.stringify(dirtyDraft));
    return true;
  } catch {
    // Storage may be unavailable or full.
    return false;
  }
}

export function saveActiveViewerSnapshot(snapshot: ViewerDraft): void {
  try {
    localStorage.setItem(ACTIVE_VIEWER_KEY, JSON.stringify(snapshot));
  } catch {
    // Storage may be unavailable or full.
  }
}

export function removeViewerDraft(identity: string): void {
  try {
    localStorage.removeItem(storageKey(identity));
  } catch {
    // ignore
  }
}

export function clearActiveViewerSnapshot(identity?: string): void {
  try {
    const active = loadActiveViewerSnapshot();
    if (!identity || active?.identity === identity) {
      localStorage.removeItem(ACTIVE_VIEWER_KEY);
    }
    sessionStorage.removeItem(LEGACY_ACTIVE_DRAFT_KEY);
  } catch {
    // ignore
  }
}

export function loadActiveViewerSnapshot(): ViewerDraft | null {
  try {
    const raw = localStorage.getItem(ACTIVE_VIEWER_KEY);
    if (raw) {
      const snapshot = JSON.parse(raw) as ViewerDraft;
      const updatedAt = Date.parse(snapshot.updatedAt);
      const expired = !Number.isFinite(updatedAt) || Date.now() - updatedAt > ACTIVE_VIEWER_TTL_MS;
      if (expired || !snapshot.identity || !snapshot.source?.recordId || !snapshot.fields) {
        localStorage.removeItem(ACTIVE_VIEWER_KEY);
        return null;
      }
      return { ...snapshot, dirty: snapshot.dirty ?? true };
    }

    // One-time migration from the sessionStorage pointer used by the first draft implementation.
    const legacyIdentity = sessionStorage.getItem(LEGACY_ACTIVE_DRAFT_KEY);
    const legacyDraft = legacyIdentity ? loadViewerDraft(legacyIdentity) : null;
    sessionStorage.removeItem(LEGACY_ACTIVE_DRAFT_KEY);
    if (legacyDraft?.source.recordId) {
      saveActiveViewerSnapshot(legacyDraft);
      return legacyDraft;
    }
    return null;
  } catch {
    return null;
  }
}
