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
        (cases as any[]).map((c) => ({ id: c.id, projectId: c.projectId, name: c.name })),
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

  // Project picker items
  const projectPickerItems = projects.map((p) => ({ name: p.name, color: p.color }));
  const projectIdMap: Record<string, string> = {};
  const projectNameMap: Record<string, string> = {};
  projects.forEach((p) => {
    projectIdMap[p.name] = p.id;
    projectNameMap[p.id] = p.name;
  });

  // Case picker: filter by selected project
  const filteredCases = projectId ? allCases.filter((c) => c.projectId === projectId) : allCases;
  const casePickerItems = filteredCases.map((c) => {
    const projName = projectNameMap[c.projectId];
    const label = projectId ? c.name : c.name + (projName ? ` (${projName})` : "");
    return { name: label, color: "#757575" };
  });
  const caseIdMap: Record<string, string> = {};
  const caseNameMap: Record<string, string> = {};
  filteredCases.forEach((c) => {
    const projName = projectNameMap[c.projectId];
    const label = projectId ? c.name : c.name + (projName ? ` (${projName})` : "");
    caseIdMap[label] = c.id;
    caseNameMap[c.id] = label;
  });

  // Task picker: filter by selected project/case, sort by status → createdAt
  const recentRank = new Map(recentTaskIds.map((id, index) => [id, index]));
  const filteredTasks = allTasks
    .filter((t) => {
      if (t.status === "done") return false;
      if (caseId) return t.caseId === caseId;
      if (projectId) return t.projectId === projectId;
      return true;
    })
    .sort((a, b) => comparePickerTasks(a, b, recentRank));
  const taskPickerItems = filteredTasks.map((t) => {
    const statusColor = (STATUS_CONFIG[t.status] || { color: "#9e9e9e" }).color;
    let label = t.name;
    if (!projectId) {
      // Show hierarchy path when no project filter
      const projName = projectNameMap[t.projectId] || "";
      const caseName = allCases.find((c) => c.id === t.caseId)?.name || "";
      const path = [projName, caseName].filter(Boolean).join(" > ");
      if (path) label = t.name + ` (${path})`;
    } else if (!caseId && t.caseId) {
      const caseName = allCases.find((c) => c.id === t.caseId)?.name || "";
      if (caseName) label = t.name + ` (${caseName})`;
    }
    return { name: label, color: statusColor };
  });
  const taskIdMap: Record<string, string> = {};
  filteredTasks.forEach((t) => {
    let label = t.name;
    if (!projectId) {
      const projName = projectNameMap[t.projectId] || "";
      const caseName = allCases.find((c) => c.id === t.caseId)?.name || "";
      const path = [projName, caseName].filter(Boolean).join(" > ");
      if (path) label = t.name + ` (${path})`;
    } else if (!caseId && t.caseId) {
      const caseName = allCases.find((c) => c.id === t.caseId)?.name || "";
      if (caseName) label = t.name + ` (${caseName})`;
    }
    taskIdMap[label] = t.id;
  });

  // --- Selected labels ---
  const selectedProjectLabel =
    projectId && projectNameMap[projectId] ? [projectNameMap[projectId]] : [];
  const selectedCaseLabel = caseId && caseNameMap[caseId] ? [caseNameMap[caseId]] : [];
  const selectedTaskLabel: string[] = [];
  if (taskId) {
    const label = Object.entries(taskIdMap).find(([, id]) => id === taskId)?.[0];
    if (label) selectedTaskLabel.push(label);
  }

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
          emptyLabel="ケース"
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

const PICKER_STATUS_ORDER: Record<string, number> = {
  doing: 1,
  review: 2,
  todo: 3,
  pending: 4,
  docs: 5,
};

function comparePickerTasks(
  a: TaskItem,
  b: TaskItem,
  recentRank: Map<string, number>,
): number {
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
