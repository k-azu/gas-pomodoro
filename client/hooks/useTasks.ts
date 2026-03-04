/**
 * useTasks — Task tree data, CRUD, selection, expand/collapse
 */
import { useState, useEffect, useCallback, useRef } from "react";
import * as TaskStore from "../lib/taskStore";
import * as EntityStore from "../lib/entityStore";
import { STORAGE_KEYS, lsGetJSON, lsSetJSON, lsSet } from "../lib/localStorage";
import { useNavigation } from "../contexts/NavigationContext";
import type { TaskStatus } from "../types/entities";

// =========================================================
// Types
// =========================================================

export type NodeType = "project" | "case" | "task";

export interface SelectedNode {
  type: NodeType;
  id: string;
}

export interface ProjectItem {
  id: string;
  name: string;
  color: string;
  sortOrder: number;
}

export interface CaseItem {
  id: string;
  projectId: string;
  name: string;
  color?: string;
  sortOrder: number;
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

export function statusLabelToKey(label: string): TaskStatus {
  for (const [key, cfg] of Object.entries(STATUS_CONFIG)) {
    if (cfg.label === label) return key as TaskStatus;
  }
  return "todo";
}

const EXPANDED_KEY = "gas_pomodoro_task_tree_expanded";
const VIEW_MODE_KEY = "gas_pomodoro_task_view_mode";

// =========================================================
// Hook
// =========================================================

export interface UseTasksReturn {
  projects: ProjectItem[];
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

  viewModes: Record<string, string>;
  setViewMode: (id: string, mode: "doc" | "table") => void;

  addProject: (name: string, color?: string) => Promise<void>;
  addCase: (projectId: string, name: string) => Promise<void>;
  addTask: (projectId: string, caseId: string, name: string) => Promise<void>;
  rename: (type: NodeType, id: string, name: string) => void;
  updateProjectFields: (id: string, fields: Record<string, any>) => void;
  updateCaseFields: (id: string, fields: Record<string, any>) => void;
  updateTaskFields: (id: string, fields: Record<string, any>) => void;
  archiveNode: (type: NodeType, id: string) => Promise<void>;

  reorderProjects: (ids: string[]) => void;
  reorderCases: (projectId: string, ids: string[]) => void;

  isLoading: boolean;
}

export function useTasks(): UseTasksReturn {
  const nav = useNavigation();
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [allCases, setAllCases] = useState<CaseItem[]>([]);
  const [allTasks, setAllTasks] = useState<TaskItem[]>([]);
  const [selectedNode, setSelectedNode] = useState<SelectedNode | null>(null);
  const [expandedNodes, setExpandedNodes] = useState<Record<string, boolean>>({});
  const [viewModes, setViewModes] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(false);
  const selectedRef = useRef(selectedNode);
  selectedRef.current = selectedNode;

  // Load persisted UI state (expand/collapse, view modes)
  // Note: selectedNode is validated in the initial load effect below
  useEffect(() => {
    const expanded = lsGetJSON<Record<string, boolean>>(EXPANDED_KEY);
    if (expanded) setExpandedNodes(expanded);

    const modes = lsGetJSON<Record<string, string>>(VIEW_MODE_KEY);
    if (modes) setViewModes(modes);
  }, []);

  // Refresh from store
  const refreshFromStore = useCallback(async () => {
    const [projs, cases, tasks] = await Promise.all([
      TaskStore.getProjects(),
      TaskStore.getAllCases(),
      TaskStore.getAllTasks(),
    ]);
    setProjects(projs as ProjectItem[]);
    setAllCases(cases as CaseItem[]);
    setAllTasks(tasks as TaskItem[]);
    return {
      projs: projs as ProjectItem[],
      cases: cases as CaseItem[],
      tasks: tasks as TaskItem[],
    };
  }, []);

  // Listen for EntityStore data changes
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
    EntityStore.on("dataChanged", handler);
    return () => EntityStore.off("dataChanged", handler);
  }, [refreshFromStore]);

  // Initial load — validate persisted selection against loaded data
  useEffect(() => {
    refreshFromStore().then(({ projs, cases, tasks }) => {
      const saved = lsGetJSON<SelectedNode>(STORAGE_KEYS.TASK_SELECTED);
      if (saved) {
        const exists =
          saved.type === "project"
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

  const getDirectTasks = useCallback(
    (projectId: string) =>
      allTasks
        .filter((t) => t.projectId === projectId && !t.caseId && (t as any).isActive !== false)
        .sort((a, b) => {
          const sa = STATUS_ORDER[a.status] ?? 99;
          const sb = STATUS_ORDER[b.status] ?? 99;
          if (sa !== sb) return sa - sb;
          return ((a as any).createdAt || "").localeCompare((b as any).createdAt || "");
        }),
    [allTasks],
  );

  const getTasksForCase = useCallback(
    (caseId: string) =>
      allTasks
        .filter((t) => t.caseId === caseId && (t as any).isActive !== false)
        .sort((a, b) => {
          const sa = STATUS_ORDER[a.status] ?? 99;
          const sb = STATUS_ORDER[b.status] ?? 99;
          if (sa !== sb) return sa - sb;
          return ((a as any).createdAt || "").localeCompare((b as any).createdAt || "");
        }),
    [allTasks],
  );

  // Selection
  const selectNode = useCallback(
    (type: NodeType, id: string) => {
      const node = { type, id };
      setSelectedNode(node);
      lsSetJSON(STORAGE_KEYS.TASK_SELECTED, node);
      nav.notifyTaskNodeChange(node);
    },
    [nav],
  );

  const clearSelection = useCallback(() => {
    setSelectedNode(null);
    lsSet(STORAGE_KEYS.TASK_SELECTED, "");
  }, []);

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
  const setViewMode = useCallback((id: string, mode: "doc" | "table") => {
    setViewModes((prev) => {
      const next = { ...prev, [id]: mode };
      lsSetJSON(VIEW_MODE_KEY, next);
      return next;
    });
  }, []);

  // CRUD
  const addProject = useCallback(
    async (name: string, color?: string) => {
      setIsLoading(true);
      try {
        const id = await TaskStore.addProject(name, color);
        await refreshFromStore();
        selectNode("project", id);
      } finally {
        setIsLoading(false);
      }
    },
    [refreshFromStore, selectNode],
  );

  const addCase = useCallback(
    async (projectId: string, name: string) => {
      setIsLoading(true);
      try {
        const id = await TaskStore.addCase(projectId, name);
        await refreshFromStore();
        setExpandedNodes((prev) => {
          const next = { ...prev, [projectId]: true };
          lsSetJSON(EXPANDED_KEY, next);
          return next;
        });
        selectNode("case", id);
      } finally {
        setIsLoading(false);
      }
    },
    [refreshFromStore, selectNode],
  );

  const addTask = useCallback(
    async (projectId: string, caseId: string, name: string) => {
      setIsLoading(true);
      try {
        const id = await TaskStore.addTask(projectId, caseId, name);
        await refreshFromStore();
        setExpandedNodes((prev) => {
          const next = { ...prev, [projectId]: true, ...(caseId ? { [caseId]: true } : {}) };
          lsSetJSON(EXPANDED_KEY, next);
          return next;
        });
        selectNode("task", id);
      } finally {
        setIsLoading(false);
      }
    },
    [refreshFromStore, selectNode],
  );

  const rename = useCallback((type: NodeType, id: string, name: string) => {
    if (type === "project") {
      TaskStore.updateProject(id, { name });
      setProjects((prev) => prev.map((p) => (p.id === id ? { ...p, name } : p)));
    } else if (type === "case") {
      TaskStore.updateCase(id, { name });
      setAllCases((prev) => prev.map((c) => (c.id === id ? { ...c, name } : c)));
    } else {
      TaskStore.updateTask(id, { name });
      setAllTasks((prev) => prev.map((t) => (t.id === id ? { ...t, name } : t)));
    }
  }, []);

  const updateProjectFields = useCallback((id: string, fields: Record<string, any>) => {
    TaskStore.updateProject(id, fields);
  }, []);

  const updateCaseFields = useCallback((id: string, fields: Record<string, any>) => {
    TaskStore.updateCase(id, fields);
  }, []);

  const updateTaskFields = useCallback((id: string, fields: Record<string, any>) => {
    TaskStore.updateTask(id, fields);
  }, []);

  const archiveNode = useCallback(
    async (type: NodeType, id: string) => {
      setIsLoading(true);
      try {
        if (type === "project") await TaskStore.archiveProject(id);
        else if (type === "case") await TaskStore.archiveCase(id);
        else await TaskStore.archiveTask(id);
        const { projs, cases, tasks } = await refreshFromStore();
        if (selectedRef.current?.id === id) {
          // Auto-select next node after archive
          if (type === "project") {
            // Select first remaining active project
            const active = projs.filter((p) => (p as any).isActive !== false);
            if (active.length > 0) {
              selectNode("project", active[0].id);
            } else {
              setSelectedNode(null);
              lsSet(STORAGE_KEYS.TASK_SELECTED, "");
            }
          } else if (type === "case") {
            // Select parent project
            const archivedCase = cases.find((c) => c.id === id);
            if (archivedCase) {
              selectNode("project", archivedCase.projectId);
            } else {
              setSelectedNode(null);
              lsSet(STORAGE_KEYS.TASK_SELECTED, "");
            }
          } else {
            // task: select parent case or project
            const archivedTask = tasks.find((t) => t.id === id);
            if (archivedTask?.caseId) {
              selectNode("case", archivedTask.caseId);
            } else if (archivedTask) {
              selectNode("project", archivedTask.projectId);
            } else {
              setSelectedNode(null);
              lsSet(STORAGE_KEYS.TASK_SELECTED, "");
            }
          }
        }
      } finally {
        setIsLoading(false);
      }
    },
    [refreshFromStore, selectNode],
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
    viewModes,
    setViewMode,
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
    isLoading,
  };
}
