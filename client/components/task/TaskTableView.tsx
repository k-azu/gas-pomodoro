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

interface TaskTableViewProps {
  tasks: UseTasksReturn;
  parentType: "project" | "case";
  parentId: string;
}

export function TaskTableView({ tasks, parentType, parentId }: TaskTableViewProps) {
  if (parentType === "project") {
    return <ProjectTable key={parentId} tasks={tasks} projectId={parentId} />;
  }
  return <CaseTable key={parentId} tasks={tasks} caseId={parentId} />;
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

  return (
    <div className={s["task-table-content"]}>
      <TaskTableGroup
        title={cases.length > 0 || archivedCases.length > 0 ? "直属タスク" : ""}
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
}: {
  title?: string;
  titleSlot?: React.ReactNode;
  taskItems: TaskItem[];
  tasks: UseTasksReturn;
  projectId: string;
  caseId: string;
  loadArchivedTasks?: () => Promise<TaskItem[]>;
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
          {taskItems.map((t) => (
            <TaskTableRow key={t.id} task={t} tasks={tasks} />
          ))}
          {showArchived &&
            archivedTasks?.map((t) => <ArchivedTaskRow key={t.id} task={t} tasks={tasks} />)}
        </tbody>
      </table>
      {!showArchived && hasArchived && (
        <div className={s["task-table-add"]} onClick={() => setUserExpanded(true)}>
          アーカイブ済みを読み込む
        </div>
      )}
      <div
        className={s["task-table-add"]}
        onClick={() => {
          const name = prompt("タスク名:");
          if (name?.trim()) tasks.addTask(projectId, caseId, name.trim());
        }}
      >
        + タスク追加
      </div>
    </div>
  );
}

function TaskTableRow({ task, tasks }: { task: TaskItem; tasks: UseTasksReturn }) {
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

function ArchivedTaskRow({ task, tasks }: { task: TaskItem; tasks: UseTasksReturn }) {
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
