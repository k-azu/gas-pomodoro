/**
 * NavigationContext — Tab switching, viewer state, browser history navigation
 *
 * Tab-return model:
 *   prevTabRef          — tab before current switchTab. Return destination.
 *   restoreTab(vis)     — prevTab (if visible) → parseHash().tab (URL base tab).
 */
import { createContext, useContext, useState, useCallback, useRef, useEffect } from "react";
import { STORAGE_KEYS, lsSet, lsSetJSON } from "../lib/localStorage";
import { clearActiveViewerSnapshot, loadActiveViewerSnapshot } from "../lib/viewerDraft";
import type { DocumentSearchResult } from "../types/search";
import { requestDocumentTransition, type DocumentEditorKey } from "../lib/documentNavigationGuard";

export type TabId = "memo" | "task" | "record" | "interruption" | "viewer" | "settings";

/** Viewer state for editing records/interruptions */
export interface ViewerState {
  markdown: string;
  recordId: string | null;
  recordType: "record" | "interruption" | null;
  /** Category picker config */
  category: string;
  sheetType: "Categories" | "InterruptionCategories" | null;
  /** For interruption editing */
  interruptionType: "work" | "nonWork" | null;
  /** Time editing */
  startTime: string | null;
  endTime: string | null;
  /**
   * In-memory save callbacks (for editing in-progress interruptions).
   * If set, save writes to these callbacks instead of server.
   */
  onSaveMarkdown?: (markdown: string) => void;
  onSaveCategory?: (category: string) => void;
  onSaveType?: (type: "work" | "nonWork") => void;
  onSaveTime?: (startISO: string, endISO: string, durSecs: number) => void;
  /** Task association (work records only) */
  projectId?: string;
  caseId?: string;
  taskId?: string;
  onSaveHierarchy?: (projectId: string, caseId: string, taskId: string) => void;
  /** Actual duration in seconds (work records, for task stats delta) */
  actualDurationSeconds?: number;
  /** Stable identity for an in-memory interruption draft */
  draftId?: string;
}

export type ViewerExitIntent = "close" | "replace";
type ViewerExitGuard = (intent: ViewerExitIntent, proceed: () => void) => void;

export interface DocumentSearchRevealRequest {
  requestId: number;
  tab: "memo" | "task";
  id: string;
  query: string;
}

interface NavigationHistoryState {
  searchDocument?: DocumentSearchResult;
}

// --- URL hash helpers ---

interface ParsedHash {
  tab: "memo" | "task";
  memoId: string | null;
  taskNode: { type: string; id: string } | null;
}

function parseHash(): ParsedHash {
  const params = new URLSearchParams(location.hash.slice(1));
  return {
    tab: params.get("tab") === "task" ? "task" : "memo",
    memoId: params.get("memo") || null,
    taskNode:
      params.get("type") && params.get("id")
        ? { type: params.get("type")!, id: params.get("id")! }
        : null,
  };
}

function buildHash(s: {
  tab: string;
  memoId?: string | null;
  taskNode?: { type: string; id: string } | null;
}): string {
  const p = new URLSearchParams();
  p.set("tab", s.tab);
  if (s.memoId) p.set("memo", s.memoId);
  if (s.taskNode) {
    p.set("type", s.taskNode.type);
    p.set("id", s.taskNode.id);
  }
  return "#" + p.toString();
}

interface NavigationContextValue {
  activeTab: TabId;
  switchTab: (tab: TabId, opts?: { skipHistory?: boolean }) => void;
  viewerState: ViewerState | null;
  showViewer: (state: ViewerState) => void;
  closeViewer: () => void;
  /** Switch to the previous tab, falling back to URL hash base tab */
  restoreTab: (visibility: Record<string, boolean>, opts?: { skipHistory?: boolean }) => void;
  /** Notify that a task node was selected (for history) */
  notifyTaskNodeChange: (
    node: { type: string; id: string } | null,
    opts?: { replace?: boolean },
  ) => void;
  /** Notify that a memo was selected (for history) */
  notifyMemoChange: (memoId: string | null, opts?: { replace?: boolean }) => void;
  /**
   * Incremented on every popstate restore. Hooks watch this to re-read
   * their state from localStorage (which is updated before this increments).
   */
  restoreSeq: number;
  /** True while ViewerPanel is saving to server */
  isViewerSaving: boolean;
  setViewerSaving: (v: boolean) => void;
  registerViewerExitGuard: (guard: ViewerExitGuard | null) => void;
  /** Search query to reveal in the document opened from the search palette */
  searchRevealRequest: DocumentSearchRevealRequest | null;
  /** Document metadata retained while a search result is open (including archived documents). */
  searchOpenedDocument: DocumentSearchResult | null;
  clearSearchRevealRequest: () => void;
  /** Navigate to a specific document (memo or task node) in one action */
  navigateToDocument: (
    tab: TabId,
    details: {
      memoId?: string;
      taskNode?: { type: string; id: string };
      searchQuery?: string;
      searchDocument?: DocumentSearchResult;
    },
  ) => void;
}

const NavigationContext = createContext<NavigationContextValue | null>(null);

export function NavigationProvider({ children }: { children: React.ReactNode }) {
  const restoredViewerSnapshotRef = useRef(loadActiveViewerSnapshot());
  const restoredViewerState = restoredViewerSnapshotRef.current?.source ?? null;
  const [activeTab, setActiveTab] = useState<TabId>(restoredViewerState ? "viewer" : "memo");
  const [viewerState, setViewerState] = useState<ViewerState | null>(restoredViewerState);
  const [restoreSeq, setRestoreSeq] = useState(0);
  const [isViewerSaving, setIsViewerSaving] = useState(false);
  const [searchRevealRequest, setSearchRevealRequest] =
    useState<DocumentSearchRevealRequest | null>(null);
  const [searchOpenedDocument, setSearchOpenedDocument] = useState<DocumentSearchResult | null>(
    null,
  );
  const searchOpenedDocumentRef = useRef<DocumentSearchResult | null>(null);
  const setViewerSaving = useCallback((v: boolean) => setIsViewerSaving(v), []);
  const searchRequestSeqRef = useRef(0);
  const clearSearchRevealRequest = useCallback(() => setSearchRevealRequest(null), []);
  const viewerExitGuardRef = useRef<ViewerExitGuard | null>(null);
  const registerViewerExitGuard = useCallback((guard: ViewerExitGuard | null) => {
    viewerExitGuardRef.current = guard;
  }, []);

  // All mutable state lives in refs — pushHash reads ONLY refs (no stale closures)
  const restoringRef = useRef(false);
  const activeTabRef = useRef<TabId>(restoredViewerState ? "viewer" : "memo");
  const viewerStateRef = useRef<ViewerState | null>(restoredViewerState);
  const taskNodeRef = useRef<{ type: string; id: string } | null>(null);
  const memoIdRef = useRef<string | null>(null);
  const hasHistoryRef = useRef(false); // false = first push uses replaceState

  // --- Tab-return tracking ---
  // Tab before current switchTab — return destination for restoreTab
  const prevTabRef = useRef<TabId>("memo");

  // --- pushHash (reads only refs → no deps, stable identity) ---
  // Only memo/task are persisted to URL hash. Other tabs are transient.
  const pushHash = useCallback(
    (opts?: { replace?: boolean; state?: NavigationHistoryState | null }) => {
      if (restoringRef.current) return;

      const tab = activeTabRef.current;
      if (tab !== "memo" && tab !== "task") return;

      const hash = buildHash({
        tab,
        memoId: tab === "memo" ? memoIdRef.current : null,
        taskNode: tab === "task" ? taskNodeRef.current : null,
      });
      const retainedDocument = searchOpenedDocumentRef.current;
      const retainedDocumentMatchesTarget =
        retainedDocument &&
        ((tab === "memo" &&
          retainedDocument.type === "memo" &&
          memoIdRef.current === retainedDocument.id) ||
          (tab === "task" &&
            retainedDocument.type === "task" &&
            taskNodeRef.current?.type === "task" &&
            taskNodeRef.current.id === retainedDocument.id));
      const state =
        opts && Object.prototype.hasOwnProperty.call(opts, "state")
          ? (opts.state ?? null)
          : retainedDocumentMatchesTarget
            ? { searchDocument: retainedDocument }
            : null;

      if (opts?.replace || !hasHistoryRef.current) {
        history.replaceState(state, "", hash);
        hasHistoryRef.current = true;
      } else {
        history.pushState(state, "", hash);
      }
    },
    [],
  );

  const runDocumentSelectionChange = useCallback(
    (editorKey: DocumentEditorKey, changesSelection: boolean, proceed: () => void) => {
      if (changesSelection) {
        void requestDocumentTransition(editorKey, proceed);
      } else {
        proceed();
      }
    },
    [],
  );

  // --- switchTab ---
  const switchTab = useCallback(
    (tab: TabId, opts?: { skipHistory?: boolean }) => {
      if (tab === activeTabRef.current) return;
      setSearchRevealRequest(null);
      prevTabRef.current = activeTabRef.current;
      activeTabRef.current = tab;
      setActiveTab(tab);
      if (!opts?.skipHistory) pushHash();
    },
    [pushHash],
  );

  // --- restoreTab ---
  // prevTab (if visible) → URL hash base tab
  const restoreTab = useCallback(
    (visibility: Record<string, boolean>, opts?: { skipHistory?: boolean }) => {
      const tab = visibility[prevTabRef.current] ? prevTabRef.current : parseHash().tab;
      switchTab(tab, opts);
    },
    [switchTab],
  );

  // --- showViewer / closeViewer ---
  // Viewer is transient like record/interruption — no browser history entry.
  const showViewer = useCallback((state: ViewerState) => {
    const proceed = () => {
      viewerStateRef.current = state;
      setViewerState(state);
      prevTabRef.current = activeTabRef.current;
      activeTabRef.current = "viewer";
      setActiveTab("viewer");
    };
    if (viewerStateRef.current && viewerExitGuardRef.current) {
      viewerExitGuardRef.current("replace", proceed);
    } else {
      proceed();
    }
  }, []);

  // Just clear viewerState. RightPanel's effect detects viewer becoming invisible
  // (!vis[activeTab]) and calls restoreTab — same code path as all other tab transitions.
  const closeViewer = useCallback(() => {
    const proceed = () => {
      clearActiveViewerSnapshot();
      viewerStateRef.current = null;
      setViewerState(null);
    };
    if (viewerExitGuardRef.current) {
      viewerExitGuardRef.current("close", proceed);
    } else {
      proceed();
    }
  }, []);

  // --- notifyTaskNodeChange ---
  const notifyTaskNodeChange = useCallback(
    (node: { type: string; id: string } | null, opts?: { replace?: boolean }) => {
      setSearchRevealRequest(null);
      const current = searchOpenedDocumentRef.current;
      if (current?.type === "task" && (node?.type !== "task" || node.id !== current.id)) {
        searchOpenedDocumentRef.current = null;
        setSearchOpenedDocument(null);
      }
      taskNodeRef.current = node;
      if (!restoringRef.current) {
        pushHash(opts);
      }
    },
    [pushHash],
  );

  // --- notifyMemoChange ---
  const notifyMemoChange = useCallback(
    (memoId: string | null, opts?: { replace?: boolean }) => {
      setSearchRevealRequest(null);
      const current = searchOpenedDocumentRef.current;
      if (current?.type === "memo" && memoId !== current.id) {
        searchOpenedDocumentRef.current = null;
        setSearchOpenedDocument(null);
      }
      memoIdRef.current = memoId;
      if (!restoringRef.current) {
        pushHash(opts);
      }
    },
    [pushHash],
  );

  // --- navigateToDocument ---
  const navigateToDocument = useCallback(
    (
      tab: TabId,
      details: {
        memoId?: string;
        taskNode?: { type: string; id: string };
        searchQuery?: string;
        searchDocument?: DocumentSearchResult;
      },
    ) => {
      const targetId =
        tab === "memo" ? details.memoId : tab === "task" ? details.taskNode?.id : undefined;
      const currentId =
        tab === "memo" ? memoIdRef.current : tab === "task" ? taskNodeRef.current?.id : undefined;
      const changesSelection =
        tab === "memo"
          ? Boolean(targetId && targetId !== currentId)
          : tab === "task"
            ? Boolean(
                details.taskNode &&
                (details.taskNode.id !== currentId ||
                  details.taskNode.type !== taskNodeRef.current?.type),
              )
            : false;
      const editorKey = tab === "memo" || tab === "task" ? tab : null;
      const proceed = () => {
        const query = details.searchQuery?.trim();
        const openedDocument =
          query && targetId && (tab === "memo" || tab === "task")
            ? (details.searchDocument ?? null)
            : null;

        // 1. Update localStorage so hooks re-read the correct state
        if (details.memoId) {
          lsSet(STORAGE_KEYS.MEMO_ACTIVE, details.memoId);
        }
        if (details.taskNode) {
          lsSetJSON(STORAGE_KEYS.TASK_SELECTED, details.taskNode);
        }

        // 2. Update refs
        if (details.memoId) memoIdRef.current = details.memoId;
        if (details.taskNode) taskNodeRef.current = details.taskNode;

        // 3. Switch tab (which also calls pushHash once)
        prevTabRef.current = activeTabRef.current;
        activeTabRef.current = tab;
        setActiveTab(tab);
        pushHash({
          state: openedDocument ? { searchDocument: openedDocument } : null,
        });

        // 4. Carry the query only for navigation originating from document search.
        if (query && targetId && (tab === "memo" || tab === "task")) {
          searchOpenedDocumentRef.current = openedDocument;
          setSearchOpenedDocument(openedDocument);
          setSearchRevealRequest({
            requestId: ++searchRequestSeqRef.current,
            tab,
            id: targetId,
            query,
          });
        } else {
          searchOpenedDocumentRef.current = null;
          setSearchOpenedDocument(null);
          setSearchRevealRequest(null);
        }

        // 5. Signal hooks to re-read from localStorage
        setRestoreSeq((s) => s + 1);
      };
      if (editorKey) {
        runDocumentSelectionChange(editorKey, changesSelection, proceed);
      } else {
        proceed();
      }
    },
    [pushHash, runDocumentSelectionChange],
  );

  // --- popstate listener ---
  useEffect(() => {
    const handler = (event: PopStateEvent) => {
      // No hash = external navigation → ignore
      if (!location.hash) return;

      const parsed = parseHash();
      const historyDocument = (event.state as NavigationHistoryState | null)?.searchDocument;
      const restoredSearchDocument =
        historyDocument &&
        ((historyDocument.type === "memo" &&
          parsed.tab === "memo" &&
          parsed.memoId === historyDocument.id) ||
          (historyDocument.type === "task" &&
            parsed.tab === "task" &&
            parsed.taskNode?.type === "task" &&
            parsed.taskNode.id === historyDocument.id))
          ? historyDocument
          : null;
      const previousHash = buildHash({
        tab: activeTabRef.current,
        memoId: memoIdRef.current,
        taskNode: taskNodeRef.current,
      });

      const editorKey = parsed.tab;
      const currentId =
        editorKey === "memo" ? memoIdRef.current : (taskNodeRef.current?.id ?? null);
      const targetId = editorKey === "memo" ? parsed.memoId : (parsed.taskNode?.id ?? null);
      const changesSelection =
        targetId !== currentId ||
        (editorKey === "task" && parsed.taskNode?.type !== taskNodeRef.current?.type);
      const proceed = () => {
        restoringRef.current = true;
        setSearchRevealRequest(null);
        searchOpenedDocumentRef.current = restoredSearchDocument;
        setSearchOpenedDocument(restoredSearchDocument);

        // Restore tab
        activeTabRef.current = parsed.tab;
        setActiveTab(parsed.tab);
        viewerStateRef.current = null;
        setViewerState(null);

        // Update refs
        if (editorKey === "memo") {
          memoIdRef.current = parsed.memoId;
        } else {
          taskNodeRef.current = parsed.taskNode;
        }

        // Persist to localStorage — hooks will re-read via restoreSeq
        if (parsed.memoId) {
          lsSet(STORAGE_KEYS.MEMO_ACTIVE, parsed.memoId);
        }
        if (parsed.taskNode) {
          lsSetJSON(STORAGE_KEYS.TASK_SELECTED, parsed.taskNode);
        }

        // Signal hooks to re-read from localStorage
        setRestoreSeq((s) => s + 1);

        // Release restoring guard after React has processed the state updates
        queueMicrotask(() => {
          restoringRef.current = false;
        });
      };
      if (changesSelection) {
        void requestDocumentTransition(editorKey, proceed).then((transitioned) => {
          if (!transitioned) history.replaceState(null, "", previousHash);
        });
      } else {
        proceed();
      }
    };

    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, []);

  // --- Seed initial state from URL hash ---
  useEffect(() => {
    if (restoredViewerSnapshotRef.current) {
      activeTabRef.current = "viewer";
      viewerStateRef.current = restoredViewerSnapshotRef.current.source;
      hasHistoryRef.current = true;
      return;
    }
    if (location.hash) {
      const parsed = parseHash();
      const historyDocument = (history.state as NavigationHistoryState | null)?.searchDocument;
      if (
        historyDocument &&
        ((historyDocument.type === "memo" &&
          parsed.tab === "memo" &&
          parsed.memoId === historyDocument.id) ||
          (historyDocument.type === "task" &&
            parsed.tab === "task" &&
            parsed.taskNode?.type === "task" &&
            parsed.taskNode.id === historyDocument.id))
      ) {
        searchOpenedDocumentRef.current = historyDocument;
        setSearchOpenedDocument(historyDocument);
      }
      activeTabRef.current = parsed.tab;
      setActiveTab(parsed.tab);
      if (parsed.memoId) {
        memoIdRef.current = parsed.memoId;
        lsSet(STORAGE_KEYS.MEMO_ACTIVE, parsed.memoId);
      }
      if (parsed.taskNode) {
        taskNodeRef.current = parsed.taskNode;
        lsSetJSON(STORAGE_KEYS.TASK_SELECTED, parsed.taskNode);
      }
      hasHistoryRef.current = true;
    }
    // No hash → hooks' initial load will call notifyXxxChange({ replace: true }) to seed
  }, []);

  return (
    <NavigationContext.Provider
      value={{
        activeTab,
        switchTab,
        viewerState,
        showViewer,
        closeViewer,
        restoreTab,
        notifyTaskNodeChange,
        notifyMemoChange,
        restoreSeq,
        isViewerSaving,
        setViewerSaving,
        registerViewerExitGuard,
        searchRevealRequest,
        searchOpenedDocument,
        clearSearchRevealRequest,
        navigateToDocument,
      }}
    >
      {children}
    </NavigationContext.Provider>
  );
}

export function useNavigation(): NavigationContextValue {
  const ctx = useContext(NavigationContext);
  if (!ctx) throw new Error("useNavigation must be used within NavigationProvider");
  return ctx;
}
