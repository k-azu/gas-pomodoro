/**
 * HierarchicalTaskPicker — Cascading Project / Case / Task picker.
 * Three ItemPickers connected: selecting one level filters/auto-fills the others.
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { RecordField } from "./RecordField";
import { ItemPicker } from "./ItemPicker";
import { ExternalLinkIcon } from "./Icons";
import s from "./HierarchicalTaskPicker.module.css";
import * as TaskStore from "../../lib/taskStore";
import { on as esOn, off as esOff } from "../../lib/entityStore";
import { STATUS_CONFIG } from "../../hooks/useTasks";
import * as DocumentStore from "../../lib/documentStore";
import { uniqueLabels } from "../../lib/uniqueLabels";
import { STORAGE_KEYS, lsGetJSON, lsSetJSON } from "../../lib/localStorage";

export interface HierarchicalTaskPickerProps {
  projectId: string | null;
  caseId: string | null;
  taskId: string | null;
  onChange: (projectId: string | null, caseId: string | null, taskId: string | null) => void;
  onOpenTask?: (taskId: string) => void;
}

interface ProjectItem {
  id: string;
  name: string;
  color: string;
}
interface CaseItem {
  id: string;
  projectId: string;
  name: string;
  color?: string;
}
interface TaskItem {
  id: string;
  projectId: string;
  caseId: string;
  name: string;
  status: string;
  createdAt: string;
}

const RECENT_TASK_LIMIT = 10;

export function HierarchicalTaskPicker({
  projectId,
  caseId,
  taskId,
  onChange,
  onOpenTask,
}: HierarchicalTaskPickerProps) {
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [allCases, setAllCases] = useState<CaseItem[]>([]);
  const [allTasks, setAllTasks] = useState<TaskItem[]>([]);
  const [recentTaskIds, setRecentTaskIds] = useState<string[]>(() => {
    const saved = lsGetJSON<string[]>(STORAGE_KEYS.RECENT_TASK_SELECTIONS);
    return Array.isArray(saved) ? saved.filter((id): id is string => typeof id === "string") : [];
  });

  // Load data from EntityStore
  const loadData = useCallback(async () => {
    try {
      const [projs, cases, tasks] = await Promise.all([
        TaskStore.getAllProjects(),
        TaskStore.getAllCases(),
        TaskStore.getAllTasks(),
      ]);
      setProjects(
        (projs as any[]).map((p) => ({ id: p.id, name: p.name, color: p.color || "#4285f4" })),
      );
      setAllCases(
        (cases as any[]).map((c) => ({
          id: c.id,
          projectId: c.projectId,
          name: c.name,
          color: c.color || undefined,
        })),
      );
      setAllTasks(
        (tasks as any[]).map((t) => ({
          id: t.id,
          projectId: t.projectId,
          caseId: t.caseId || "",
          name: t.name,
          status: t.status || "todo",
          createdAt: t.createdAt || "",
        })),
      );
    } catch {
      // Store not ready
    }
  }, []);

  useEffect(() => {
    loadData();
    const handler = (detail: any) => {
      if (
        detail?.entityType === "all" ||
        detail?.entityType === "project" ||
        detail?.entityType === "case" ||
        detail?.entityType === "task"
      ) {
        loadData();
      }
    };
    esOn("dataChanged", handler);
    return () => esOff("dataChanged", handler);
  }, [loadData]);

  // Use ref for onChange to avoid stale closures in callbacks
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // --- Derived picker items ---
  // Pickers identify items by label, so labels are made unique. The current selection is
  // always kept visible even when it is done or archived (e.g. when viewing an old record).

  const visibleProjects = withSelected(projects, projectId, (id) => {
    const p = DocumentStore.get("projects", id) as { name?: string; color?: string } | null;
    return p ? { id, name: String(p.name ?? ""), color: p.color || "#9e9e9e" } : null;
  });
  const projectNameMap: Record<string, string> = {};
  visibleProjects.forEach((p) => {
    projectNameMap[p.id] = p.name;
  });
  const projectLabels = uniqueLabels(visibleProjects.map((p) => p.name));
  const projectPickerItems = visibleProjects.map((p, i) => ({
    name: projectLabels[i],
    color: p.color,
  }));
  const projectIdMap = labelMap(visibleProjects, projectLabels);

  // Case picker: filter by selected project
  const knownCases = withSelected<CaseItem>(allCases, caseId, (id) => {
    const c = DocumentStore.get("cases", id) as {
      name?: string;
      projectId?: string;
      color?: string;
    } | null;
    return c
      ? {
          id,
          projectId: String(c.projectId ?? ""),
          name: String(c.name ?? ""),
          color: c.color || undefined,
        }
      : null;
  });
  const caseNameById = new Map(knownCases.map((c) => [c.id, c.name]));
  const filteredCases = projectId
    ? knownCases.filter((c) => c.projectId === projectId)
    : knownCases;
  const caseLabels = uniqueLabels(
    filteredCases.map((c) => {
      const projName = projectNameMap[c.projectId];
      return projectId ? c.name : c.name + (projName ? ` (${projName})` : "");
    }),
  );
  const casePickerItems = filteredCases.map((c, i) => ({
    name: caseLabels[i],
    color: c.color || "#757575",
  }));
  const caseIdMap = labelMap(filteredCases, caseLabels);

  // Task picker: filter by selected project/case, sort by status → createdAt
  const recentRank = new Map(recentTaskIds.map((id, index) => [id, index]));
  const knownTasks = withSelected(allTasks, taskId, (id) => {
    const t = DocumentStore.get("tasks", id) as Record<string, unknown> | null;
    return t
      ? {
          id,
          projectId: String(t.projectId ?? ""),
          caseId: String(t.caseId ?? ""),
          name: String(t.name ?? ""),
          status: String(t.status ?? "todo"),
          createdAt: String(t.createdAt ?? ""),
        }
      : null;
  });
  const filteredTasks = knownTasks
    .filter((t) => {
      if (t.status === "done" && t.id !== taskId) return false;
      if (caseId) return t.caseId === caseId;
      if (projectId) return t.projectId === projectId;
      return true;
    })
    .sort((a, b) => comparePickerTasks(a, b, recentRank));
  const taskLabels = uniqueLabels(
    filteredTasks.map((t) => {
      if (!projectId) {
        // Show hierarchy path when no project filter
        const projName = projectNameMap[t.projectId] || "";
        const caseName = caseNameById.get(t.caseId) || "";
        const path = [projName, caseName].filter(Boolean).join(" > ");
        return path ? `${t.name} (${path})` : t.name;
      }
      if (!caseId && t.caseId) {
        const caseName = caseNameById.get(t.caseId) || "";
        if (caseName) return `${t.name} (${caseName})`;
      }
      return t.name;
    }),
  );
  const taskPickerItems = filteredTasks.map((t, i) => ({
    name: taskLabels[i],
    color: (STATUS_CONFIG[t.status] || { color: "#9e9e9e" }).color,
  }));
  const taskIdMap = labelMap(filteredTasks, taskLabels);

  // --- Selected labels ---
  const selectedLabel = (map: Record<string, string>, id: string | null) => {
    const label = id ? Object.entries(map).find(([, value]) => value === id)?.[0] : undefined;
    return label ? [label] : [];
  };
  const selectedProjectLabel = selectedLabel(projectIdMap, projectId);
  const selectedCaseLabel = selectedLabel(caseIdMap, caseId);
  const selectedTaskLabel = selectedLabel(taskIdMap, taskId);

  // --- Handlers ---

  const handleProjectSelect = useCallback(
    (selected: string[]) => {
      const newProjId = selected.length > 0 ? projectIdMap[selected[0]] || null : null;
      // Project changed → clear case and task
      onChangeRef.current(newProjId, null, null);
    },
    [projectIdMap],
  );

  const handleCaseSelect = useCallback(
    (selected: string[]) => {
      const newCaseId = selected.length > 0 ? caseIdMap[selected[0]] || null : null;
      if (newCaseId) {
        // Auto-fill project from case
        const c = allCases.find((c) => c.id === newCaseId);
        const autoProjId = c?.projectId || projectId;
        onChangeRef.current(autoProjId, newCaseId, null);
      } else {
        onChangeRef.current(projectId, null, null);
      }
    },
    [caseIdMap, allCases, projectId],
  );

  const handleTaskSelect = useCallback(
    (selected: string[]) => {
      const newTaskId = selected.length > 0 ? taskIdMap[selected[0]] || null : null;
      if (newTaskId) {
        setRecentTaskIds((current) => {
          const next = [newTaskId, ...current.filter((id) => id !== newTaskId)].slice(
            0,
            RECENT_TASK_LIMIT,
          );
          lsSetJSON(STORAGE_KEYS.RECENT_TASK_SELECTIONS, next);
          return next;
        });
        // Auto-fill project and case from task
        const t = allTasks.find((t) => t.id === newTaskId);
        if (t) {
          onChangeRef.current(t.projectId || projectId, t.caseId || caseId, newTaskId);
        } else {
          onChangeRef.current(projectId, caseId, newTaskId);
        }
      } else {
        onChangeRef.current(projectId, caseId, null);
      }
    },
    [taskIdMap, allTasks, projectId, caseId],
  );

  const handleOpenTask = useCallback(() => {
    if (!taskId) return;
    onOpenTask?.(taskId);
  }, [onOpenTask, taskId]);

  if (projects.length === 0) return null;

  return (
    <RecordField label="タスク">
      <div className={s["hierarchy-row"]}>
        <ItemPicker
          mode="single"
          items={projectPickerItems}
          selected={selectedProjectLabel}
          onSelect={handleProjectSelect}
          placeholder="検索..."
          emptyLabel="プロジェクト"
          compact
        />
        <span className={s["hierarchy-sep"]}>/</span>
        <ItemPicker
          mode="single"
          items={casePickerItems}
          selected={selectedCaseLabel}
          onSelect={handleCaseSelect}
          placeholder="検索..."
          emptyLabel="案件"
          compact
        />
        <span className={s["hierarchy-sep"]}>/</span>
        <ItemPicker
          mode="single"
          items={taskPickerItems}
          selected={selectedTaskLabel}
          onSelect={handleTaskSelect}
          placeholder="検索..."
          emptyLabel="タスク"
          compact
        />
        {taskId && onOpenTask && (
          <button
            type="button"
            className={s["open-task-btn"]}
            onClick={(event) => {
              event.stopPropagation();
              handleOpenTask();
            }}
            aria-label="タスクを開く"
            title="タスクを開く"
          >
            <ExternalLinkIcon size={14} />
          </button>
        )}
      </div>
    </RecordField>
  );
}

/** Append the selected entity when it is filtered out of the active list (done/archived). */
function withSelected<T extends { id: string }>(
  items: T[],
  selectedId: string | null,
  lookup: (id: string) => T | null,
): T[] {
  if (!selectedId || items.some((item) => item.id === selectedId)) return items;
  const selected = lookup(selectedId);
  return selected ? [...items, selected] : items;
}

function labelMap(items: { id: string }[], labels: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  items.forEach((item, i) => {
    map[labels[i]] = item.id;
  });
  return map;
}

const PICKER_STATUS_ORDER: Record<string, number> = {
  doing: 1,
  review: 2,
  todo: 3,
  pending: 4,
  docs: 5,
};

function comparePickerTasks(a: TaskItem, b: TaskItem, recentRank: Map<string, number>): number {
  const recentA = recentRank.get(a.id);
  const recentB = recentRank.get(b.id);
  if (recentA !== undefined || recentB !== undefined) {
    if (recentA === undefined) return 1;
    if (recentB === undefined) return -1;
    return recentA - recentB;
  }

  const statusDiff = (PICKER_STATUS_ORDER[a.status] ?? 50) - (PICKER_STATUS_ORDER[b.status] ?? 50);
  if (statusDiff !== 0) return statusDiff;
  return (a.createdAt || "").localeCompare(b.createdAt || "");
}
