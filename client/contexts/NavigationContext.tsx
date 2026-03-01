/**
 * NavigationContext — Tab switching, viewer state, browser history navigation
 *
 * Tab-return model:
 *   prevTabRef          — tab before current switchTab. Return destination.
 *   restoreTab(vis)     — prevTab (if visible) → parseHash().tab (URL base tab).
 */
import { createContext, useContext, useState, useCallback, useRef, useEffect } from "react";
import { STORAGE_KEYS, lsSet, lsSetJSON } from "../lib/localStorage";

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
  taskId?: string;
  onSaveTaskId?: (taskId: string) => void;
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
}

const NavigationContext = createContext<NavigationContextValue | null>(null);

export function NavigationProvider({ children }: { children: React.ReactNode }) {
  const [activeTab, setActiveTab] = useState<TabId>("memo");
  const [viewerState, setViewerState] = useState<ViewerState | null>(null);
  const [restoreSeq, setRestoreSeq] = useState(0);

  // All mutable state lives in refs — pushHash reads ONLY refs (no stale closures)
  const restoringRef = useRef(false);
  const activeTabRef = useRef<TabId>("memo");
  const taskNodeRef = useRef<{ type: string; id: string } | null>(null);
  const memoIdRef = useRef<string | null>(null);
  const hasHistoryRef = useRef(false); // false = first push uses replaceState

  // --- Tab-return tracking ---
  // Tab before current switchTab — return destination for restoreTab
  const prevTabRef = useRef<TabId>("memo");

  // --- pushHash (reads only refs → no deps, stable identity) ---
  // Only memo/task are persisted to URL hash. Other tabs are transient.
  const pushHash = useCallback((opts?: { replace?: boolean }) => {
    if (restoringRef.current) return;

    const tab = activeTabRef.current;
    if (tab !== "memo" && tab !== "task") return;

    const hash = buildHash({
      tab,
      memoId: tab === "memo" ? memoIdRef.current : null,
      taskNode: tab === "task" ? taskNodeRef.current : null,
    });

    if (opts?.replace || !hasHistoryRef.current) {
      history.replaceState(null, "", hash);
      hasHistoryRef.current = true;
    } else {
      history.pushState(null, "", hash);
    }
  }, []);

  // --- switchTab ---
  const switchTab = useCallback(
    (tab: TabId, opts?: { skipHistory?: boolean }) => {
      prevTabRef.current = activeTabRef.current; // Record tab before switch
      activeTabRef.current = tab;
      setActiveTab(tab);
      if (!opts?.skipHistory) {
        pushHash();
      }
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
  const showViewer = useCallback(
    (state: ViewerState) => {
      setViewerState(state);
      switchTab("viewer", { skipHistory: true });
    },
    [switchTab],
  );

  // Just clear viewerState. RightPanel's effect detects viewer becoming invisible
  // (!vis[activeTab]) and calls restoreTab — same code path as all other tab transitions.
  const closeViewer = useCallback(() => {
    setViewerState(null);
  }, []);

  // --- notifyTaskNodeChange ---
  const notifyTaskNodeChange = useCallback(
    (node: { type: string; id: string } | null, opts?: { replace?: boolean }) => {
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
      memoIdRef.current = memoId;
      if (!restoringRef.current) {
        pushHash(opts);
      }
    },
    [pushHash],
  );

  // --- popstate listener ---
  useEffect(() => {
    const handler = () => {
      // No hash = external navigation → ignore
      if (!location.hash) return;

      const parsed = parseHash();

      restoringRef.current = true;

      // Restore tab
      activeTabRef.current = parsed.tab;
      setActiveTab(parsed.tab);
      setViewerState(null);

      // Update refs
      taskNodeRef.current = parsed.taskNode;
      memoIdRef.current = parsed.memoId;

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

    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, []);

  // --- Seed initial state from URL hash ---
  useEffect(() => {
    if (location.hash) {
      const parsed = parseHash();
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
