/**
 * useTasks — Task tree data, CRUD, selection, expand/collapse
 */
import { useState, useEffect, useCallback, useRef } from "react";
import * as TaskStore from "../lib/taskStore";
import * as DocumentStore from "../lib/documentStore";
import { STORAGE_KEYS, lsGetJSON, lsSetJSON, lsSet } from "../lib/localStorage";
import { useNavigation } from "../contexts/NavigationContext";
import type { TaskStatus } from "../types/entities";
import {
  requestDocumentTransition,
  runWithDocumentEditorFrozen,
} from "../lib/documentNavigationGuard";

// =========================================================
// Types
// =========================================================

export type NodeType = "all" | "project" | "case" | "task";
export type EditableNodeType = Exclude<NodeType, "all">;
export type TaskViewMode = "doc" | "table";
export type TaskTableLayoutMode = "grouped" | "flat";

export interface SelectedNode {
  type: NodeType;
  id: string;
}

export interface ProjectItem {
  id: string;
  name: string;
  color: string;
  sortOrder: number;
  isActive: boolean;
}

export interface CaseItem {
  id: string;
  projectId: string;
  name: string;
  color?: string;
  sortOrder: number;
  isActive: boolean;
}

export interface TaskItem {
  id: string;
  projectId: string;
  caseId: string;
  name: string;
  status: TaskStatus;
  startedAt: string;
  dueDate: string;
  completedAt: string;
  sortOrder: number;
  isActive: boolean;
  _cachedTimeSeconds?: number;
  _cachedPomodoroCount?: number;
}

export const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  todo: { label: "ToDo", color: "#9e9e9e" },
  doing: { label: "Doing", color: "#e53935" },
  review: { label: "Review", color: "#fb8c00" },
  done: { label: "Done", color: "#43a047" },
  pending: { label: "Pending", color: "#7e57c2" },
  docs: { label: "Docs", color: "#1e88e5" },
};

export const STATUS_ITEMS = Object.keys(STATUS_CONFIG).map((key) => ({
  name: STATUS_CONFIG[key].label,
  color: STATUS_CONFIG[key].color,
}));

// "Archived" を含むドロップダウン用アイテム（アーカイブセクション専用）
export const STATUS_ITEMS_WITH_ARCHIVED = [...STATUS_ITEMS, { name: "Archived", color: "#bdbdbd" }];

// "Archived" を含む全定義（表示・色の解決用）
export const ALL_STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  ...STATUS_CONFIG,
  archived: { label: "Archived", color: "#bdbdbd" },
};

export function statusLabelToKey(label: string): TaskStatus {
  for (const [key, cfg] of Object.entries(STATUS_CONFIG)) {
    if (cfg.label === label) return key as TaskStatus;
  }
  return "todo";
}

const EXPANDED_KEY = "gas_pomodoro_task_tree_expanded";
const VIEW_MODE_KEY = "gas_pomodoro_task_view_mode";
const TABLE_LAYOUT_MODE_KEY = "gas_pomodoro_task_table_layout_mode";

// =========================================================
// Hook
// =========================================================

export interface UseTasksReturn {
  projects: ProjectItem[];
  archivedProjects: ProjectItem[];
  allCases: CaseItem[];
  allTasks: TaskItem[];
  getCasesFor: (projectId: string) => CaseItem[];
  getDirectTasks: (projectId: string) => TaskItem[];
  getTasksForCase: (caseId: string) => TaskItem[];

  selectedNode: SelectedNode | null;
  selectNode: (type: NodeType, id: string) => void;
  clearSelection: () => void;

  expandedNodes: Record<string, boolean>;
  toggleExpand: (id: string) => void;

  taskViewMode: TaskViewMode;
  setTaskViewMode: (mode: TaskViewMode) => void;
  tableLayoutMode: TaskTableLayoutMode;
  setTableLayoutMode: (mode: TaskTableLayoutMode) => void;

  addProject: (name: string, color?: string) => Promise<void>;
  addCase: (projectId: string, name: string) => Promise<void>;
  addTask: (projectId: string, caseId: string, name: string) => Promise<void>;
  rename: (type: EditableNodeType, id: string, name: string) => void;
  updateProjectFields: (id: string, fields: Record<string, any>) => void;
  updateCaseFields: (id: string, fields: Record<string, any>) => void;
  updateTaskFields: (id: string, fields: Record<string, any>) => void;
  archiveNode: (type: EditableNodeType, id: string) => Promise<void>;

  reorderProjects: (ids: string[]) => void;
  reorderCases: (projectId: string, ids: string[]) => void;

  loadArchived: (projectId: string) => Promise<void>;
  getArchivedCasesFor: (projectId: string) => CaseItem[];
  getArchivedDirectTasks: (projectId: string) => TaskItem[];
  unarchiveProject: (projectId: string) => Promise<void>;
  unarchiveCase: (caseId: string) => Promise<void>;
  unarchiveTask: (taskId: string, status: TaskStatus) => Promise<void>;

  isLoading: boolean;
}

export function useTasks(): UseTasksReturn {
  const nav = useNavigation();
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [archivedProjects, setArchivedProjects] = useState<ProjectItem[]>([]);
  const [allCases, setAllCases] = useState<CaseItem[]>([]);
  const [allTasks, setAllTasks] = useState<TaskItem[]>([]);
  const [selectedNode, setSelectedNode] = useState<SelectedNode | null>(null);
  const [expandedNodes, setExpandedNodes] = useState<Record<string, boolean>>({});
  const [taskViewMode, setTaskViewModeState] = useState<TaskViewMode>("doc");
  const [tableLayoutMode, setTableLayoutModeState] = useState<TaskTableLayoutMode>("grouped");
  const [isLoading, setIsLoading] = useState(false);
  const selectedRef = useRef(selectedNode);
  selectedRef.current = selectedNode;

  const commitSelection = useCallback(
    (node: SelectedNode) => {
      setSelectedNode(node);
      lsSetJSON(STORAGE_KEYS.TASK_SELECTED, node);
      nav.notifyTaskNodeChange(node);
    },
    [nav],
  );

  // Load persisted UI state (expand/collapse, view modes)
  // Note: selectedNode is validated in the initial load effect below
  useEffect(() => {
    const expanded = lsGetJSON<Record<string, boolean>>(EXPANDED_KEY);
    if (expanded) setExpandedNodes(expanded);

    const savedMode = lsGetJSON<TaskViewMode | Record<string, string>>(VIEW_MODE_KEY);
    if (savedMode === "doc" || savedMode === "table") {
      setTaskViewModeState(savedMode);
    } else if (savedMode && Object.values(savedMode).includes("table")) {
      setTaskViewModeState("table");
    }

    const savedLayout = lsGetJSON<TaskTableLayoutMode>(TABLE_LAYOUT_MODE_KEY);
    if (savedLayout === "grouped" || savedLayout === "flat") {
      setTableLayoutModeState(savedLayout);
    }
  }, []);

  // Refresh from store
  const refreshFromStore = useCallback(async () => {
    const [projs, archivedProjs, cases, tasks] = await Promise.all([
      TaskStore.getProjects(),
      TaskStore.getArchivedProjects(),
      TaskStore.getAllCases(),
      TaskStore.getAllTasks(),
    ]);
    setProjects(projs as ProjectItem[]);
    setArchivedProjects(archivedProjs as ProjectItem[]);
    setAllCases(cases as CaseItem[]);
    setAllTasks(tasks as TaskItem[]);
    return {
      projs: projs as ProjectItem[],
      cases: cases as CaseItem[],
      tasks: tasks as TaskItem[],
    };
  }, []);

  // Listen for in-memory document changes
  useEffect(() => {
    const handler = (detail: { entityType?: string }) => {
      if (
        !detail ||
        detail.entityType === "project" ||
        detail.entityType === "case" ||
        detail.entityType === "task" ||
        detail.entityType === "all"
      ) {
        refreshFromStore();
      }
    };
    DocumentStore.on(handler);
    return () => DocumentStore.off(handler);
  }, [refreshFromStore]);

  // Initial load — validate persisted selection against loaded data
  useEffect(() => {
    refreshFromStore().then(({ projs, cases, tasks }) => {
      const saved = lsGetJSON<SelectedNode>(STORAGE_KEYS.TASK_SELECTED);
      if (saved) {
        const exists =
          saved.type === "all"
            ? saved.id === "all"
            : saved.type === "project"
              ? projs.some((p) => p.id === saved.id)
              : saved.type === "case"
                ? cases.some((c) => c.id === saved.id)
                : tasks.some((t) => t.id === saved.id);
        if (exists) {
          setSelectedNode(saved);
          nav.notifyTaskNodeChange(saved, { replace: true });
        } else {
          // Fallback: select first project or clear
          if (projs.length > 0) {
            const fallback: SelectedNode = { type: "project", id: projs[0].id };
            setSelectedNode(fallback);
            lsSetJSON(STORAGE_KEYS.TASK_SELECTED, fallback);
            nav.notifyTaskNodeChange(fallback, { replace: true });
          } else {
            setSelectedNode(null);
            lsSet(STORAGE_KEYS.TASK_SELECTED, "");
          }
        }
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Restore task node from popstate — re-read from localStorage when restoreSeq changes
  const lastSeenSeqRef = useRef(nav.restoreSeq);
  useEffect(() => {
    if (nav.restoreSeq !== lastSeenSeqRef.current) {
      lastSeenSeqRef.current = nav.restoreSeq;
      const saved = lsGetJSON<SelectedNode>(STORAGE_KEYS.TASK_SELECTED);
      if (saved) {
        setSelectedNode(saved);
      }
    }
  }, [nav.restoreSeq]);

  // Derived data helpers
  const getCasesFor = useCallback(
    (projectId: string) =>
      allCases
        .filter((c) => c.projectId === projectId && (c as any).isActive !== false)
        .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0)),
    [allCases],
  );

  const STATUS_ORDER: Record<string, number> = {
    docs: 0,
    doing: 1,
    review: 2,
    todo: 3,
    pending: 4,
    done: 5,
  };

  const compareTasks = (a: TaskItem, b: TaskItem) => {
    const sa = STATUS_ORDER[a.status] ?? 99;
    const sb = STATUS_ORDER[b.status] ?? 99;
    if (sa !== sb) return sa - sb;

    const dueA = a.dueDate || "9999-12-31";
    const dueB = b.dueDate || "9999-12-31";
    const dueDiff = dueA.localeCompare(dueB);
    if (dueDiff !== 0) return dueDiff;

    return ((a as any).createdAt || "").localeCompare((b as any).createdAt || "");
  };

  const getDirectTasks = useCallback(
    (projectId: string) =>
      allTasks
        .filter((t) => t.projectId === projectId && !t.caseId && (t as any).isActive !== false)
        .sort(compareTasks),
    [allTasks],
  );

  const getTasksForCase = useCallback(
    (caseId: string) =>
      allTasks
        .filter((t) => t.caseId === caseId && (t as any).isActive !== false)
        .sort(compareTasks),
    [allTasks],
  );

  // Selection
  const selectNode = useCallback(
    (type: NodeType, id: string) => {
      const node = { type, id };
      if (selectedRef.current?.type === type && selectedRef.current.id === id) return;
      void requestDocumentTransition("task", () => {
        commitSelection(node);
      });
    },
    [commitSelection],
  );

  const clearSelection = useCallback(() => {
    void requestDocumentTransition("task", () => {
      setSelectedNode(null);
      lsSet(STORAGE_KEYS.TASK_SELECTED, "");
      nav.notifyTaskNodeChange(null);
    });
  }, [nav]);

  // Expand/collapse
  const toggleExpand = useCallback((id: string) => {
    setExpandedNodes((prev) => {
      const next = { ...prev };
      if (next[id]) delete next[id];
      else next[id] = true;
      lsSetJSON(EXPANDED_KEY, next);
      return next;
    });
  }, []);

  // View mode
  const setTaskViewMode = useCallback((mode: TaskViewMode) => {
    setTaskViewModeState(mode);
    lsSetJSON(VIEW_MODE_KEY, mode);
  }, []);

  const setTableLayoutMode = useCallback((mode: TaskTableLayoutMode) => {
    setTableLayoutModeState(mode);
    lsSetJSON(TABLE_LAYOUT_MODE_KEY, mode);
  }, []);

  // CRUD
  const addProject = useCallback(
    async (name: string, color?: string) => {
      setIsLoading(true);
      try {
        await runWithDocumentEditorFrozen("task", async () => {
          try {
            const id = await TaskStore.addProject(name, color);
            await refreshFromStore();
            commitSelection({ type: "project", id });
            return true;
          } catch (error) {
            console.error("Project creation failed", error);
            throw error;
          }
        });
      } finally {
        setIsLoading(false);
      }
    },
    [commitSelection, refreshFromStore],
  );

  const addCase = useCallback(
    async (projectId: string, name: string) => {
      setIsLoading(true);
      try {
        await runWithDocumentEditorFrozen("task", async () => {
          try {
            const id = await TaskStore.addCase(projectId, name);
            await refreshFromStore();
            setExpandedNodes((prev) => {
              const next = { ...prev, [projectId]: true };
              lsSetJSON(EXPANDED_KEY, next);
              return next;
            });
            commitSelection({ type: "case", id });
            return true;
          } catch (error) {
            console.error("Case creation failed", error);
            throw error;
          }
        });
      } finally {
        setIsLoading(false);
      }
    },
    [commitSelection, refreshFromStore],
  );

  const addTask = useCallback(
    async (projectId: string, caseId: string, name: string) => {
      setIsLoading(true);
      try {
        await runWithDocumentEditorFrozen("task", async () => {
          try {
            const id = await TaskStore.addTask(projectId, caseId, name);
            await refreshFromStore();
            setExpandedNodes((prev) => {
              const next = { ...prev, [projectId]: true, ...(caseId ? { [caseId]: true } : {}) };
              lsSetJSON(EXPANDED_KEY, next);
              return next;
            });
            commitSelection({ type: "task", id });
            return true;
          } catch (error) {
            console.error("Task creation failed", error);
            throw error;
          }
        });
      } finally {
        setIsLoading(false);
      }
    },
    [commitSelection, refreshFromStore],
  );

  const rename = useCallback((type: EditableNodeType, id: string, name: string) => {
    if (type === "project") {
      void TaskStore.updateProject(id, { name }).catch((error) =>
        console.error("Project metadata save failed; the patch remains pending", error),
      );
      setProjects((prev) => prev.map((p) => (p.id === id ? { ...p, name } : p)));
    } else if (type === "case") {
      void TaskStore.updateCase(id, { name }).catch((error) =>
        console.error("Case metadata save failed; the patch remains pending", error),
      );
      setAllCases((prev) => prev.map((c) => (c.id === id ? { ...c, name } : c)));
    } else {
      void TaskStore.updateTask(id, { name }).catch((error) =>
        console.error("Task metadata save failed; the patch remains pending", error),
      );
      setAllTasks((prev) => prev.map((t) => (t.id === id ? { ...t, name } : t)));
    }
  }, []);

  const updateProjectFields = useCallback((id: string, fields: Record<string, any>) => {
    void TaskStore.updateProject(id, fields).catch((error) =>
      console.error("Project metadata save failed; the patch remains pending", error),
    );
  }, []);

  const updateCaseFields = useCallback((id: string, fields: Record<string, any>) => {
    void TaskStore.updateCase(id, fields).catch((error) =>
      console.error("Case metadata save failed; the patch remains pending", error),
    );
  }, []);

  const updateTaskFields = useCallback((id: string, fields: Record<string, any>) => {
    void TaskStore.updateTask(id, fields).catch((error) =>
      console.error("Task metadata save failed; the patch remains pending", error),
    );
  }, []);

  const archiveNode = useCallback(
    async (type: EditableNodeType, id: string) => {
      setIsLoading(true);
      try {
        if (type === "project") await TaskStore.archiveProject(id);
        else if (type === "case") await TaskStore.archiveCase(id);
        else await TaskStore.archiveTask(id);
        await refreshFromStore();
      } finally {
        setIsLoading(false);
      }
    },
    [refreshFromStore],
  );

  // =========================================================
  // Archived data
  // =========================================================
  const [archivedCases, setArchivedCases] = useState<CaseItem[]>([]);
  const [archivedTasks, setArchivedTasks] = useState<TaskItem[]>([]);

  const loadArchived = useCallback(async (projectId: string) => {
    const [cases, tasks] = await Promise.all([
      TaskStore.getArchivedCases(projectId),
      TaskStore.getArchivedDirectTasks(projectId),
    ]);
    setArchivedCases((prev) => [...prev.filter((c) => c.projectId !== projectId), ...cases]);
    setArchivedTasks((prev) => [...prev.filter((t) => t.projectId !== projectId), ...tasks]);
  }, []);

  const getArchivedCasesFor = useCallback(
    (projectId: string) => archivedCases.filter((c) => c.projectId === projectId),
    [archivedCases],
  );

  const getArchivedDirectTasks = useCallback(
    (projectId: string) => archivedTasks.filter((t) => t.projectId === projectId && !t.caseId),
    [archivedTasks],
  );

  const unarchiveCase = useCallback(
    async (caseId: string) => {
      await TaskStore.unarchiveCase(caseId);
      await refreshFromStore();
    },
    [refreshFromStore],
  );

  const unarchiveProject = useCallback(
    async (projectId: string) => {
      await TaskStore.unarchiveProject(projectId);
      await refreshFromStore();
    },
    [refreshFromStore],
  );

  const unarchiveTask = useCallback(
    async (taskId: string, status: TaskStatus) => {
      await TaskStore.unarchiveTask(taskId, status);
      await refreshFromStore();
    },
    [refreshFromStore],
  );

  // Reorder
  const reorderProjects = useCallback((ids: string[]) => {
    TaskStore.reorderProjects(ids);
    setProjects((prev) => {
      const map = new Map(prev.map((p) => [p.id, p]));
      return ids.map((id, i) => {
        const p = map.get(id)!;
        return { ...p, sortOrder: i + 1 };
      });
    });
  }, []);

  const reorderCases = useCallback((projectId: string, ids: string[]) => {
    TaskStore.reorderCases(projectId, ids);
    setAllCases((prev) => {
      const map = new Map(prev.filter((c) => c.projectId === projectId).map((c) => [c.id, c]));
      const reordered = ids.map((id, i) => {
        const c = map.get(id)!;
        return { ...c, sortOrder: i + 1 };
      });
      const others = prev.filter((c) => c.projectId !== projectId);
      return [...others, ...reordered];
    });
  }, []);

  return {
    projects,
    archivedProjects,
    allCases,
    allTasks,
    getCasesFor,
    getDirectTasks,
    getTasksForCase,
    selectedNode,
    selectNode,
    clearSelection,
    expandedNodes,
    toggleExpand,
    taskViewMode,
    setTaskViewMode,
    tableLayoutMode,
    setTableLayoutMode,
    addProject,
    addCase,
    addTask,
    rename,
    updateProjectFields,
    updateCaseFields,
    updateTaskFields,
    archiveNode,
    reorderProjects,
    reorderCases,
    loadArchived,
    getArchivedCasesFor,
    getArchivedDirectTasks,
    unarchiveProject,
    unarchiveCase,
    unarchiveTask,
    isLoading,
  };
}
