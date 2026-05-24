/**
 * TaskTableView — Table view for project/case showing tasks in rows
 */
import { useState, useEffect, useCallback } from "react";
import type { UseTasksReturn, TaskItem, CaseItem } from "../../hooks/useTasks";
import {
  STATUS_CONFIG,
  STATUS_ITEMS_WITH_ARCHIVED,
  ALL_STATUS_CONFIG,
  statusLabelToKey,
} from "../../hooks/useTasks";
import * as TaskStore from "../../lib/taskStore";
import { EditIcon, FileIcon } from "../shared/Icons";
import { ItemPicker } from "../shared/ItemPicker";
import s from "./TaskTableView.module.css";

const STATUS_ORDER: Record<string, number> = {
  docs: 0,
  doing: 1,
  review: 2,
  todo: 3,
  pending: 4,
  done: 5,
};

interface TaskTableViewProps {
  tasks: UseTasksReturn;
  parentType: "all" | "project" | "case";
  parentId: string;
}

export function TaskTableView({ tasks, parentType, parentId }: TaskTableViewProps) {
  if (parentType === "all") {
    return <AllProjectsTable tasks={tasks} />;
  }
  if (parentType === "project") {
    return <ProjectTable key={parentId} tasks={tasks} projectId={parentId} />;
  }
  return <CaseTable key={parentId} tasks={tasks} caseId={parentId} />;
}

type StatusFilter = "not_done" | "all" | keyof typeof STATUS_CONFIG;
type DueFilter = "all" | "overdue" | "today" | "next7" | "none";

function AllProjectsTable({ tasks }: { tasks: UseTasksReturn }) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("not_done");
  const [dueFilter, setDueFilter] = useState<DueFilter>("all");
  const projectNameById = new Map(tasks.projects.map((p) => [p.id, p.name]));
  const caseNameById = new Map(tasks.allCases.map((c) => [c.id, c.name]));
  const taskItems = tasks.allTasks
    .filter((t) => (t as any).isActive !== false)
    .filter((t) => matchStatusFilter(t, statusFilter))
    .filter((t) => matchDueFilter(t, dueFilter))
    .slice()
    .sort(compareFlatTasks);

  return (
    <div className={s["task-table-content"]}>
      <div className={s["task-table-filter-bar"]}>
        <label className={s["task-table-filter"]}>
          <span>Status</span>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          >
            <option value="not_done">未完了</option>
            <option value="all">すべて</option>
            {Object.entries(STATUS_CONFIG).map(([key, cfg]) => (
              <option key={key} value={key}>
                {cfg.label}
              </option>
            ))}
          </select>
        </label>
        <label className={s["task-table-filter"]}>
          <span>期限</span>
          <select value={dueFilter} onChange={(e) => setDueFilter(e.target.value as DueFilter)}>
            <option value="all">すべて</option>
            <option value="overdue">期限切れ</option>
            <option value="today">今日</option>
            <option value="next7">今後7日</option>
            <option value="none">期限なし</option>
          </select>
        </label>
        <span className={s["task-table-filter-count"]}>{taskItems.length}件</span>
      </div>
      <TaskTableGroup
        title=""
        taskItems={taskItems}
        tasks={tasks}
        projectId=""
        caseId=""
        showProjectColumn
        showCaseColumn
        allowAddTask={false}
        getProjectName={(projectId) => projectNameById.get(projectId) || "-"}
        getCaseName={(caseId) => (caseId ? caseNameById.get(caseId) || "" : "-")}
      />
    </div>
  );
}

function ProjectTable({ tasks, projectId }: { tasks: UseTasksReturn; projectId: string }) {
  const cases = tasks.getCasesFor(projectId);
  const directTasks = tasks.getDirectTasks(projectId);
  const [archivedLoaded, setArchivedLoaded] = useState(false);
  const archivedCases = tasks.getArchivedCasesFor(projectId);

  const { loadArchived } = tasks;
  // Prefetch archived cases count
  useEffect(() => {
    loadArchived(projectId);
  }, [loadArchived, projectId]);

  const loadArchivedDirect = useCallback(
    () => TaskStore.getArchivedDirectTasks(projectId),
    [projectId],
  );

  if (tasks.tableLayoutMode === "flat") {
    return <ProjectFlatTable tasks={tasks} projectId={projectId} cases={cases} />;
  }

  return (
    <div className={s["task-table-content"]}>
      <TaskTableGroup
        title=""
        taskItems={directTasks}
        tasks={tasks}
        projectId={projectId}
        caseId=""
        loadArchivedTasks={loadArchivedDirect}
      />
      {cases.map((c) => (
        <CaseTableGroup key={c.id} tasks={tasks} caseItem={c} />
      ))}
      {archivedLoaded && archivedCases.length > 0 && (
        <div className={s["archive-cases-section"]}>
          {archivedCases.map((c) => (
            <ArchivedCaseGroup key={c.id} caseItem={c} tasks={tasks} />
          ))}
        </div>
      )}
      {!archivedLoaded && archivedCases.length > 0 && (
        <div className={s["task-table-add"]} onClick={() => setArchivedLoaded(true)}>
          アーカイブ済みの案件を読み込む
        </div>
      )}
    </div>
  );
}

function ProjectFlatTable({
  tasks,
  projectId,
  cases,
}: {
  tasks: UseTasksReturn;
  projectId: string;
  cases: CaseItem[];
}) {
  const archivedCases = tasks.getArchivedCasesFor(projectId);
  const flatCaseItems = [...cases, ...archivedCases];
  const flatCaseIds = flatCaseItems.map((c) => c.id);
  const flatCaseIdKey = flatCaseIds.join(",");
  const caseNameById = new Map(flatCaseItems.map((c) => [c.id, c.name]));
  const caseTasks = cases.flatMap((c) => tasks.getTasksForCase(c.id));
  const taskItems = [...tasks.getDirectTasks(projectId), ...caseTasks].sort(compareFlatTasks);
  const loadArchivedFlatTasks = useCallback(async () => {
    const archivedTaskGroups = await Promise.all([
      TaskStore.getArchivedDirectTasks(projectId),
      ...flatCaseIds.map((caseId) => TaskStore.getArchivedTasksForCase(caseId)),
    ]);
    return archivedTaskGroups.flat().sort(compareFlatTasks) as TaskItem[];
  }, [flatCaseIdKey, projectId]);

  return (
    <div className={s["task-table-content"]}>
      <TaskTableGroup
        title=""
        taskItems={taskItems}
        tasks={tasks}
        projectId={projectId}
        caseId=""
        loadArchivedTasks={loadArchivedFlatTasks}
        showCaseColumn
        getCaseName={(caseId) => (caseId ? caseNameById.get(caseId) || "" : "-")}
      />
    </div>
  );
}

function compareFlatTasks(a: TaskItem, b: TaskItem): number {
  const statusDiff = (STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99);
  if (statusDiff !== 0) return statusDiff;

  const dueA = a.dueDate || "9999-12-31";
  const dueB = b.dueDate || "9999-12-31";
  const dueDiff = dueA.localeCompare(dueB);
  if (dueDiff !== 0) return dueDiff;

  return ((a as any).createdAt || "").localeCompare((b as any).createdAt || "");
}

function matchStatusFilter(task: TaskItem, filter: StatusFilter): boolean {
  if (filter === "all") return true;
  if (filter === "not_done") return task.status !== "done";
  return task.status === filter;
}

function matchDueFilter(task: TaskItem, filter: DueFilter): boolean {
  if (filter === "all") return true;
  const dueDate = task.dueDate ? task.dueDate.slice(0, 10) : "";
  if (filter === "none") return !dueDate;
  if (!dueDate) return false;

  const today = formatLocalDate(new Date());
  if (filter === "overdue") return dueDate < today;
  if (filter === "today") return dueDate === today;
  if (filter === "next7") {
    const end = new Date();
    end.setDate(end.getDate() + 6);
    return dueDate >= today && dueDate <= formatLocalDate(end);
  }
  return true;
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function CaseTable({ tasks, caseId }: { tasks: UseTasksReturn; caseId: string }) {
  const caseTasks = tasks.getTasksForCase(caseId);
  const caseItem = tasks.allCases.find((c) => c.id === caseId);
  const projectId = caseItem?.projectId || "";

  const loadArchivedForCase = useCallback(
    () => TaskStore.getArchivedTasksForCase(caseId),
    [caseId],
  );

  return (
    <div className={s["task-table-content"]}>
      <TaskTableGroup
        title=""
        taskItems={caseTasks}
        tasks={tasks}
        projectId={projectId}
        caseId={caseId}
        loadArchivedTasks={loadArchivedForCase}
      />
    </div>
  );
}

function CaseTableGroup({ tasks, caseItem }: { tasks: UseTasksReturn; caseItem: any }) {
  const [renaming, setRenaming] = useState(false);
  const caseTasks = tasks.getTasksForCase(caseItem.id);
  const loadArchivedForCase = useCallback(
    () => TaskStore.getArchivedTasksForCase(caseItem.id),
    [caseItem.id],
  );

  const navigateToCase = () => tasks.selectNode("case", caseItem.id);

  const header = (
    <div className={s["task-table-group-header"]}>
      {renaming ? (
        <>
          <FileIcon size={14} color="#757575" />
          <input
            type="text"
            className={s["task-table-name-input"]}
            defaultValue={caseItem.name}
            autoFocus
            onClick={(e) => e.stopPropagation()}
            onBlur={(e) => {
              const newName = e.target.value.trim();
              if (newName && newName !== caseItem.name) {
                tasks.rename("case", caseItem.id, newName);
              }
              setRenaming(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") {
                (e.target as HTMLInputElement).value = caseItem.name;
                (e.target as HTMLInputElement).blur();
              }
            }}
          />
        </>
      ) : (
        <>
          <span className={s["task-table-group-name"]} onClick={navigateToCase}>
            <FileIcon size={14} color="#757575" />
            {caseItem.name}
          </span>
          <span className={s["task-table-group-count"]}>{caseTasks.length}件</span>
          <button
            className={s["task-table-edit-btn"]}
            title="名前を変更"
            onClick={(e) => {
              e.stopPropagation();
              setRenaming(true);
            }}
          >
            <EditIcon />
          </button>
        </>
      )}
    </div>
  );

  return (
    <TaskTableGroup
      titleSlot={header}
      taskItems={caseTasks}
      tasks={tasks}
      projectId={caseItem.projectId}
      caseId={caseItem.id}
      loadArchivedTasks={loadArchivedForCase}
    />
  );
}

function TaskTableGroup({
  title,
  titleSlot,
  taskItems,
  tasks,
  projectId,
  caseId,
  loadArchivedTasks,
  allowAddTask = true,
  showProjectColumn = false,
  showCaseColumn = false,
  getProjectName,
  getCaseName,
}: {
  title?: string;
  titleSlot?: React.ReactNode;
  taskItems: TaskItem[];
  tasks: UseTasksReturn;
  projectId: string;
  caseId: string;
  loadArchivedTasks?: () => Promise<TaskItem[]>;
  allowAddTask?: boolean;
  showProjectColumn?: boolean;
  showCaseColumn?: boolean;
  getProjectName?: (projectId: string) => string;
  getCaseName?: (caseId: string) => string;
}) {
  const [archivedTasks, setArchivedTasks] = useState<TaskItem[] | null>(null);
  const [userExpanded, setUserExpanded] = useState(false);

  // Re-fetch archived tasks when active taskItems change (archive/unarchive)
  const taskItemIds = taskItems.map((t) => t.id).join(",");
  useEffect(() => {
    if (loadArchivedTasks) {
      loadArchivedTasks().then((items) => setArchivedTasks(items as TaskItem[]));
    }
  }, [loadArchivedTasks, taskItemIds]);

  const hasArchived = archivedTasks !== null && archivedTasks.length > 0;
  const showArchived = hasArchived && userExpanded;

  return (
    <div className={s["task-table-group"]}>
      {titleSlot || (title && <div className={s["task-table-group-header"]}>{title}</div>)}
      <table
        className={`${s["task-table"]} ${showCaseColumn ? s["task-table-with-case"] : ""} ${showProjectColumn ? s["task-table-with-project"] : ""}`}
      >
        <thead>
          <tr>
            <th>名前</th>
            {showProjectColumn && <th>プロジェクト</th>}
            {showCaseColumn && <th>案件</th>}
            <th>Status</th>
            <th>開始</th>
            <th>期限</th>
            <th>完了</th>
            <th>作業時間</th>
          </tr>
        </thead>
        <tbody>
          {taskItems.map((t) => (
            <TaskTableRow
              key={t.id}
              task={t}
              tasks={tasks}
              showProjectColumn={showProjectColumn}
              showCaseColumn={showCaseColumn}
              projectName={getProjectName?.(t.projectId || "") || ""}
              caseName={getCaseName?.(t.caseId || "") || ""}
            />
          ))}
          {showArchived &&
            archivedTasks?.map((t) => (
              <ArchivedTaskRow
                key={t.id}
                task={t}
                tasks={tasks}
                showProjectColumn={showProjectColumn}
                showCaseColumn={showCaseColumn}
                projectName={getProjectName?.(t.projectId || "") || ""}
                caseName={getCaseName?.(t.caseId || "") || ""}
              />
            ))}
        </tbody>
      </table>
      {!showArchived && hasArchived && (
        <div className={s["task-table-add"]} onClick={() => setUserExpanded(true)}>
          アーカイブ済みを読み込む
        </div>
      )}
      {allowAddTask && (
        <div
          className={s["task-table-add"]}
          onClick={() => {
            const name = prompt("タスク名:");
            if (name?.trim()) tasks.addTask(projectId, caseId, name.trim());
          }}
        >
          + タスク追加
        </div>
      )}
    </div>
  );
}

function TaskTableRow({
  task,
  tasks,
  showProjectColumn = false,
  showCaseColumn = false,
  projectName = "",
  caseName = "",
}: {
  task: TaskItem;
  tasks: UseTasksReturn;
  showProjectColumn?: boolean;
  showCaseColumn?: boolean;
  projectName?: string;
  caseName?: string;
}) {
  const [renaming, setRenaming] = useState(false);
  const sc = STATUS_CONFIG[task.status] || STATUS_CONFIG.todo;

  return (
    <tr className={s["task-table-row"]} onClick={() => tasks.selectNode("task", task.id)}>
      {/* Name */}
      <td className={s["task-table-name-cell"]}>
        {renaming ? (
          <input
            type="text"
            className={s["task-table-name-input"]}
            defaultValue={task.name}
            autoFocus
            onClick={(e) => e.stopPropagation()}
            onBlur={(e) => {
              const newName = e.target.value.trim();
              if (newName && newName !== task.name) {
                tasks.updateTaskFields(task.id, { name: newName });
              }
              setRenaming(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") {
                (e.target as HTMLInputElement).value = task.name;
                (e.target as HTMLInputElement).blur();
              }
            }}
          />
        ) : (
          <>
            <span className={s["task-table-name"]}>{task.name}</span>
            <button
              className={s["task-table-edit-btn"]}
              title="名前を変更"
              onClick={(e) => {
                e.stopPropagation();
                setRenaming(true);
              }}
            >
              <EditIcon />
            </button>
          </>
        )}
      </td>

      {showProjectColumn && (
        <td className={s["task-table-case"]}>
          <button
            type="button"
            className={s["task-table-case-link"]}
            onClick={(e) => {
              e.stopPropagation();
              tasks.selectNode("project", task.projectId);
            }}
          >
            {projectName || "-"}
          </button>
        </td>
      )}

      {showCaseColumn && (
        <td className={s["task-table-case"]}>
          {task.caseId ? (
            <button
              type="button"
              className={s["task-table-case-link"]}
              onClick={(e) => {
                e.stopPropagation();
                tasks.selectNode("case", task.caseId);
              }}
            >
              {caseName || "-"}
            </button>
          ) : (
            <span>{caseName || "-"}</span>
          )}
        </td>
      )}

      {/* Status */}
      <td onClick={(e) => e.stopPropagation()}>
        <div className={s["task-table-status-area"]}>
          <ItemPicker
            mode="single"
            items={STATUS_ITEMS_WITH_ARCHIVED}
            selected={[sc.label]}
            removable={false}
            compact
            onSelect={(selected) => {
              if (selected.length > 0) {
                const label = selected[0];
                if (label === "Archived") {
                  tasks.updateTaskFields(task.id, { isActive: false });
                } else {
                  const key = statusLabelToKey(label);
                  tasks.updateTaskFields(task.id, { status: key });
                }
              }
            }}
            placeholder="ステータス"
          />
        </div>
      </td>

      {/* Start date */}
      <td onClick={(e) => e.stopPropagation()}>
        <input
          type="date"
          className={s["task-table-date-input"]}
          value={task.startedAt ? task.startedAt.slice(0, 10) : ""}
          onChange={(e) => tasks.updateTaskFields(task.id, { startedAt: e.target.value || "" })}
        />
      </td>

      {/* Due date */}
      <td onClick={(e) => e.stopPropagation()}>
        <input
          type="date"
          className={s["task-table-date-input"]}
          value={task.dueDate ? task.dueDate.slice(0, 10) : ""}
          onChange={(e) => tasks.updateTaskFields(task.id, { dueDate: e.target.value || "" })}
        />
      </td>

      {/* Completed */}
      <td className={s["task-table-completed"]}>
        {task.completedAt ? task.completedAt.slice(0, 10) : "-"}
      </td>

      {/* Time */}
      <td className={s["task-table-time"]}>
        {task._cachedTimeSeconds ? formatTime(task._cachedTimeSeconds) : "-"}
      </td>
    </tr>
  );
}

// =========================================================
// Archived components
// =========================================================

function ArchivedCaseGroup({ caseItem, tasks }: { caseItem: CaseItem; tasks: UseTasksReturn }) {
  const [caseTasks, setCaseTasks] = useState<TaskItem[]>([]);

  useEffect(() => {
    TaskStore.getArchivedTasksForCase(caseItem.id).then((items) =>
      setCaseTasks(items as TaskItem[]),
    );
  }, [caseItem.id]);

  const handleUnarchive = useCallback(() => {
    tasks.unarchiveCase(caseItem.id);
  }, [tasks, caseItem.id]);

  return (
    <div className={s["archive-case-group"]}>
      <div className={s["archive-case-header"]}>
        <FileIcon size={14} color="#9e9e9e" />
        <span
          className={`${s["archive-case-name"]} ${s["task-table-group-name"]}`}
          onClick={() => tasks.selectNode("case", caseItem.id)}
        >
          {caseItem.name}
        </span>
        <button className={s["archive-unarchive-btn"]} onClick={handleUnarchive}>
          アーカイブ解除
        </button>
      </div>
      {caseTasks.length > 0 && (
        <table className={s["task-table"]}>
          <thead>
            <tr>
              <th>名前</th>
              <th>Status</th>
              <th>開始</th>
              <th>期限</th>
              <th>完了</th>
              <th>作業時間</th>
            </tr>
          </thead>
          <tbody>
            {caseTasks.map((t) => (
              <ArchivedTaskRow key={t.id} task={t} tasks={tasks} />
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function ArchivedTaskRow({
  task,
  tasks,
  showProjectColumn = false,
  showCaseColumn = false,
  projectName = "",
  caseName = "",
}: {
  task: TaskItem;
  tasks: UseTasksReturn;
  showProjectColumn?: boolean;
  showCaseColumn?: boolean;
  projectName?: string;
  caseName?: string;
}) {
  const isArchived = (task as any).isActive === false;
  const displayLabel = isArchived
    ? ALL_STATUS_CONFIG.archived.label
    : (STATUS_CONFIG[task.status] || STATUS_CONFIG.todo).label;
  return (
    <tr
      className={`${s["task-table-row"]} ${s["archive-row"]}`}
      onClick={() => tasks.selectNode("task", task.id)}
    >
      {/* Name */}
      <td className={s["task-table-name-cell"]}>
        <span className={s["task-table-name"]}>{task.name}</span>
      </td>

      {showProjectColumn && (
        <td className={s["task-table-case"]}>
          <button
            type="button"
            className={s["task-table-case-link"]}
            onClick={(e) => {
              e.stopPropagation();
              tasks.selectNode("project", task.projectId);
            }}
          >
            {projectName || "-"}
          </button>
        </td>
      )}

      {showCaseColumn && (
        <td className={s["task-table-case"]}>
          {task.caseId ? (
            <button
              type="button"
              className={s["task-table-case-link"]}
              onClick={(e) => {
                e.stopPropagation();
                tasks.selectNode("case", task.caseId);
              }}
            >
              {caseName || "-"}
            </button>
          ) : (
            <span>{caseName || "-"}</span>
          )}
        </td>
      )}

      {/* Status */}
      <td onClick={(e) => e.stopPropagation()}>
        <div className={s["task-table-status-area"]}>
          <ItemPicker
            mode="single"
            items={STATUS_ITEMS_WITH_ARCHIVED}
            selected={[displayLabel]}
            removable={false}
            compact
            onSelect={(selected) => {
              if (selected.length === 0) return;
              const label = selected[0];
              if (label === "Archived") {
                // Already archived — no-op
              } else {
                const key = statusLabelToKey(label);
                tasks.updateTaskFields(task.id, { status: key, isActive: true });
              }
            }}
            placeholder="ステータス"
          />
        </div>
      </td>

      {/* Start date — empty for archived */}
      <td />

      {/* Due date — empty for archived */}
      <td />

      {/* Completed */}
      <td className={s["task-table-completed"]}>
        {task.completedAt ? task.completedAt.slice(0, 10) : "-"}
      </td>

      {/* Time */}
      <td className={s["task-table-time"]}>
        {task._cachedTimeSeconds ? formatTime(task._cachedTimeSeconds) : "-"}
      </td>
    </tr>
  );
}

function formatTime(seconds: number): string {
  if (!seconds) return "";
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h${mins > 0 ? `${mins}m` : ""}`;
  return `${mins}m`;
}
