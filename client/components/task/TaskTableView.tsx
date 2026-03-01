/**
 * TaskTableView — Table view for project/case showing tasks in rows
 */
import { useState } from "react";
import type { UseTasksReturn, TaskItem } from "../../hooks/useTasks";
import { STATUS_CONFIG, STATUS_ITEMS, statusLabelToKey } from "../../hooks/useTasks";
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
    return <ProjectTable tasks={tasks} projectId={parentId} />;
  }
  return <CaseTable tasks={tasks} caseId={parentId} />;
}

function ProjectTable({ tasks, projectId }: { tasks: UseTasksReturn; projectId: string }) {
  const cases = tasks.getCasesFor(projectId);
  const directTasks = tasks.getDirectTasks(projectId);

  return (
    <div className={s['task-table-content']}>
      {(directTasks.length > 0 || cases.length > 0) && (
        <TaskTableGroup
          title={cases.length > 0 ? "直属タスク" : ""}
          taskItems={directTasks}
          tasks={tasks}
          projectId={projectId}
          caseId=""
        />
      )}
      {cases.map((c) => (
        <CaseTableGroup key={c.id} tasks={tasks} caseItem={c} />
      ))}
    </div>
  );
}

function CaseTable({ tasks, caseId }: { tasks: UseTasksReturn; caseId: string }) {
  const caseTasks = tasks.getTasksForCase(caseId);
  // Find projectId from first task or from allCases
  const caseItem = tasks.allCases.find((c) => c.id === caseId);
  const projectId = caseItem?.projectId || "";

  return (
    <div className={s['task-table-content']}>
      <TaskTableGroup title="" taskItems={caseTasks} tasks={tasks} projectId={projectId} caseId={caseId} />
    </div>
  );
}

function CaseTableGroup({ tasks, caseItem }: { tasks: UseTasksReturn; caseItem: any }) {
  const [renaming, setRenaming] = useState(false);
  const caseTasks = tasks.getTasksForCase(caseItem.id);

  const navigateToCase = () => tasks.selectNode("case", caseItem.id);

  const header = (
    <div className={s['task-table-group-header']}>
      {renaming ? (
        <>
          <FileIcon size={14} color="#757575" />
          <input
            type="text"
            className={s['task-table-name-input']}
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
          <span className={s['task-table-group-name']} onClick={navigateToCase}>
            <FileIcon size={14} color="#757575" />
            {caseItem.name}
          </span>
          <button
            className={s['task-table-edit-btn']}
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
}: {
  title?: string;
  titleSlot?: React.ReactNode;
  taskItems: TaskItem[];
  tasks: UseTasksReturn;
  projectId: string;
  caseId: string;
}) {
  return (
    <div className={s['task-table-group']}>
      {titleSlot || (title && <div className={s['task-table-group-header']}>{title}</div>)}
      <table className={s['task-table']}>
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
        </tbody>
      </table>
      <div
        className={s['task-table-add']}
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
    <tr className={s['task-table-row']} onClick={() => tasks.selectNode("task", task.id)}>
      {/* Name */}
      <td className={s['task-table-name-cell']}>
        {renaming ? (
          <input
            type="text"
            className={s['task-table-name-input']}
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
            <span className={s['task-table-name']}>{task.name}</span>
            <button
              className={s['task-table-edit-btn']}
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
        <div className={s['task-table-status-area']}>
          <ItemPicker
            mode="single"
            items={STATUS_ITEMS}
            selected={[sc.label]}
            removable={false}
            compact
            onSelect={(selected) => {
              if (selected.length > 0) {
                const key = statusLabelToKey(selected[0]);
                tasks.updateTaskFields(task.id, { status: key });
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
          className={s['task-table-date-input']}
          value={task.startedAt ? task.startedAt.slice(0, 10) : ""}
          onChange={(e) => tasks.updateTaskFields(task.id, { startedAt: e.target.value || "" })}
        />
      </td>

      {/* Due date */}
      <td onClick={(e) => e.stopPropagation()}>
        <input
          type="date"
          className={s['task-table-date-input']}
          value={task.dueDate ? task.dueDate.slice(0, 10) : ""}
          onChange={(e) => tasks.updateTaskFields(task.id, { dueDate: e.target.value || "" })}
        />
      </td>

      {/* Completed */}
      <td className={s['task-table-completed']}>
        {task.completedAt ? task.completedAt.slice(0, 10) : "-"}
      </td>

      {/* Time */}
      <td className={s['task-table-time']}>
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

