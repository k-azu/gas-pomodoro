/**
 * TaskTree — Hierarchical tree sidebar for projects/cases/tasks.
 * Long press + drag to reorder projects or cases (within same project).
 * Ghost clone + placeholder visual feedback (matches original GAS TaskPanel).
 */
import type {
  UseTasksReturn,
  NodeType,
  ProjectItem,
  CaseItem,
  TaskItem,
} from "../../hooks/useTasks";
import { STATUS_CONFIG } from "../../hooks/useTasks";
import { InlineRename } from "../shared/SidebarShell";
import { FolderIcon, FileIcon, MemoIcon } from "../shared/Icons";
import { useLongPressDrag } from "../../hooks/useLongPressDrag";
import s from "./TaskTree.module.css";

interface TaskTreeProps {
  tasks: UseTasksReturn;
  renamingNode: { type: NodeType; id: string } | null;
  onRenameCommit: (name: string) => void;
  onRenameCancel: () => void;
  onContextMenu: (
    e: React.MouseEvent,
    type: NodeType,
    data: ProjectItem | CaseItem | TaskItem,
  ) => void;
}

export function TaskTree({
  tasks,
  renamingNode,
  onRenameCommit,
  onRenameCancel,
  onContextMenu,
}: TaskTreeProps) {
  const drag = useLongPressDrag(
    (dragId, newOrder) => {
      const isProject = tasks.projects.some((p) => p.id === dragId);
      if (isProject) {
        tasks.reorderProjects(newOrder);
        return;
      }
      const dragCase = tasks.allCases.find((c) => c.id === dragId);
      if (dragCase) {
        tasks.reorderCases(dragCase.projectId, newOrder);
      }
    },
    {
      enabled: tasks.projects.length > 0,
      getContainer: (el) => {
        const groupEl = el.closest("[data-type]") as HTMLElement | null;
        return groupEl?.parentElement ?? null;
      },
      getItems: (container, draggingId) => {
        const isProject = tasks.projects.some((p) => p.id === draggingId);
        const selector = isProject
          ? ':scope > [data-type="project"]'
          : ':scope > [data-type="case"]';
        return Array.from(container.querySelectorAll(selector)).filter(
          (el) => (el as HTMLElement).dataset.id !== draggingId,
        ) as HTMLElement[];
      },
    },
  );

  // Determine drag type for rendering
  const isProjectDrag =
    drag.draggingId != null && tasks.projects.some((p) => p.id === drag.draggingId);
  const isCaseDrag = drag.draggingId != null && !isProjectDrag;
  const dragCaseProjectId = isCaseDrag
    ? tasks.allCases.find((c) => c.id === drag.draggingId)?.projectId
    : null;

  // Build project display list with placeholder
  const projectDisplay: Array<{ type: "project"; project: ProjectItem } | { type: "placeholder" }> =
    [];
  let projVisIdx = 0;
  for (const proj of tasks.projects) {
    if (proj.id === drag.draggingId) continue;
    if (isProjectDrag && projVisIdx === drag.placeholderIdx) {
      projectDisplay.push({ type: "placeholder" });
    }
    projectDisplay.push({ type: "project", project: proj });
    projVisIdx++;
  }
  if (isProjectDrag && projVisIdx === drag.placeholderIdx) {
    projectDisplay.push({ type: "placeholder" });
  }

  return (
    <>
      {projectDisplay.map((entry) => {
        if (entry.type === "placeholder") {
          return (
            <div
              key="__drag-ph__"
              className={s["drag-placeholder"]}
              style={{ height: drag.placeholderHeight }}
            />
          );
        }
        return (
          <ProjectNode
            key={entry.project.id}
            project={entry.project}
            tasks={tasks}
            renamingNode={renamingNode}
            onRenameCommit={onRenameCommit}
            onRenameCancel={onRenameCancel}
            onContextMenu={onContextMenu}
            drag={drag}
            isCaseDrag={isCaseDrag}
            dragCaseProjectId={dragCaseProjectId}
          />
        );
      })}
    </>
  );
}

type DragResult = ReturnType<typeof useLongPressDrag>;

function ProjectNode({
  project,
  tasks,
  renamingNode,
  onRenameCommit,
  onRenameCancel,
  onContextMenu,
  drag,
  isCaseDrag,
  dragCaseProjectId,
}: {
  project: ProjectItem;
  tasks: UseTasksReturn;
  renamingNode: { type: NodeType; id: string } | null;
  onRenameCommit: (name: string) => void;
  onRenameCancel: () => void;
  onContextMenu: (e: React.MouseEvent, type: NodeType, data: any) => void;
  drag: DragResult;
  isCaseDrag: boolean;
  dragCaseProjectId: string | null | undefined;
}) {
  const expanded = !!tasks.expandedNodes[project.id];
  const isActive = tasks.selectedNode?.type === "project" && tasks.selectedNode?.id === project.id;
  const isRenaming = renamingNode?.type === "project" && renamingNode?.id === project.id;

  const cases = expanded ? tasks.getCasesFor(project.id) : [];
  const directTasks = expanded ? tasks.getDirectTasks(project.id) : [];

  const handlers = drag.bind(project.id);

  // Case placeholder in this project?
  const isCaseInThisProject = isCaseDrag && dragCaseProjectId === project.id;

  // Build case display list with placeholder
  const caseDisplay: Array<{ type: "case"; caseItem: CaseItem } | { type: "placeholder" }> = [];
  if (expanded) {
    let caseVisIdx = 0;
    for (const c of cases) {
      if (c.id === drag.draggingId) continue;
      if (isCaseInThisProject && caseVisIdx === drag.placeholderIdx) {
        caseDisplay.push({ type: "placeholder" });
      }
      caseDisplay.push({ type: "case", caseItem: c });
      caseVisIdx++;
    }
    if (isCaseInThisProject && caseVisIdx === drag.placeholderIdx) {
      caseDisplay.push({ type: "placeholder" });
    }
  }

  return (
    <div className={s["task-tree-group"]} data-id={project.id} data-type="project">
      <div
        className={`${s["task-tree-item"]} ${s["task-tree-project"]}${isActive ? ` ${s.active}` : ""}`}
        onClick={() => {
          if (drag.didActivate.current) {
            drag.didActivate.current = false;
            return;
          }
          tasks.selectNode("project", project.id);
        }}
        onContextMenu={(e) => onContextMenu(e, "project", project)}
        onPointerDown={handlers.onPointerDown}
        onPointerMove={handlers.onPointerMove}
        onPointerUp={handlers.onPointerUp}
        onPointerCancel={handlers.onPointerCancel}
      >
        <span
          className={s["task-tree-toggle"]}
          onClick={(e) => {
            e.stopPropagation();
            tasks.toggleExpand(project.id);
          }}
        >
          <span className={`${s["task-tree-chevron"]}${expanded ? ` ${s.expanded}` : ""}`}>▶</span>
          <span className={s["task-tree-icon"]}>
            <FolderIcon size={16} color={project.color || "#4285f4"} />
          </span>
        </span>
        {isRenaming ? (
          <InlineRename
            initialValue={project.name}
            onCommit={onRenameCommit}
            onCancel={onRenameCancel}
          />
        ) : (
          <span className={s["task-tree-name"]}>{project.name}</span>
        )}
        <span
          className={s["task-tree-add-btn"]}
          title="案件を追加"
          onClick={(e) => {
            e.stopPropagation();
            if (!expanded) tasks.toggleExpand(project.id);
            const name = prompt("案件名:");
            if (name?.trim()) tasks.addCase(project.id, name.trim());
          }}
        >
          +
        </span>
      </div>

      {expanded && (
        <div className={s["task-tree-children"]}>
          {caseDisplay.map((entry) => {
            if (entry.type === "placeholder") {
              return (
                <div
                  key="__drag-ph__"
                  className={s["drag-placeholder"]}
                  style={{ height: drag.placeholderHeight }}
                />
              );
            }
            return (
              <CaseNode
                key={entry.caseItem.id}
                caseItem={entry.caseItem}
                tasks={tasks}
                renamingNode={renamingNode}
                onRenameCommit={onRenameCommit}
                onRenameCancel={onRenameCancel}
                onContextMenu={onContextMenu}
                drag={drag}
              />
            );
          })}
          {directTasks.map((t) => (
            <TaskNode
              key={t.id}
              task={t}
              tasks={tasks}
              renamingNode={renamingNode}
              onRenameCommit={onRenameCommit}
              onRenameCancel={onRenameCancel}
              onContextMenu={onContextMenu}
            />
          ))}
          <div
            className={`${s["task-tree-add"]} ${s["task-tree-add-task"]}`}
            onClick={(e) => {
              e.stopPropagation();
              const name = prompt("タスク名:");
              if (name?.trim()) tasks.addTask(project.id, "", name.trim());
            }}
          >
            + タスク
          </div>
        </div>
      )}
    </div>
  );
}

function CaseNode({
  caseItem,
  tasks,
  renamingNode,
  onRenameCommit,
  onRenameCancel,
  onContextMenu,
  drag,
}: {
  caseItem: CaseItem;
  tasks: UseTasksReturn;
  renamingNode: { type: NodeType; id: string } | null;
  onRenameCommit: (name: string) => void;
  onRenameCancel: () => void;
  onContextMenu: (e: React.MouseEvent, type: NodeType, data: any) => void;
  drag: DragResult;
}) {
  const expanded = !!tasks.expandedNodes[caseItem.id];
  const isActive = tasks.selectedNode?.type === "case" && tasks.selectedNode?.id === caseItem.id;
  const isRenaming = renamingNode?.type === "case" && renamingNode?.id === caseItem.id;

  const caseTasks = expanded ? tasks.getTasksForCase(caseItem.id) : [];

  const handlers = drag.bind(caseItem.id);

  return (
    <div
      className={`${s["task-tree-group"]} ${s["task-tree-case-group"]}`}
      data-id={caseItem.id}
      data-type="case"
    >
      <div
        className={`${s["task-tree-item"]} ${s["task-tree-case"]}${isActive ? ` ${s.active}` : ""}`}
        onClick={() => {
          if (drag.didActivate.current) {
            drag.didActivate.current = false;
            return;
          }
          tasks.selectNode("case", caseItem.id);
        }}
        onContextMenu={(e) => onContextMenu(e, "case", caseItem)}
        onPointerDown={handlers.onPointerDown}
        onPointerMove={handlers.onPointerMove}
        onPointerUp={handlers.onPointerUp}
        onPointerCancel={handlers.onPointerCancel}
      >
        <span
          className={s["task-tree-toggle"]}
          onClick={(e) => {
            e.stopPropagation();
            tasks.toggleExpand(caseItem.id);
          }}
        >
          <span className={`${s["task-tree-chevron"]}${expanded ? ` ${s.expanded}` : ""}`}>▶</span>
          <span className={s["task-tree-icon"]}>
            <FileIcon size={16} color={caseItem.color || "#757575"} />
          </span>
        </span>
        {isRenaming ? (
          <InlineRename
            initialValue={caseItem.name}
            onCommit={onRenameCommit}
            onCancel={onRenameCancel}
          />
        ) : (
          <span className={s["task-tree-name"]}>{caseItem.name}</span>
        )}
        <span
          className={s["task-tree-add-btn"]}
          title="タスクを追加"
          onClick={(e) => {
            e.stopPropagation();
            if (!expanded) tasks.toggleExpand(caseItem.id);
            const name = prompt("タスク名:");
            if (name?.trim()) tasks.addTask(caseItem.projectId, caseItem.id, name.trim());
          }}
        >
          +
        </span>
      </div>

      {expanded && (
        <div className={s["task-tree-children"]}>
          {caseTasks.map((t) => (
            <TaskNode
              key={t.id}
              task={t}
              tasks={tasks}
              renamingNode={renamingNode}
              onRenameCommit={onRenameCommit}
              onRenameCancel={onRenameCancel}
              onContextMenu={onContextMenu}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TaskNode({
  task,
  tasks,
  renamingNode,
  onRenameCommit,
  onRenameCancel,
  onContextMenu,
}: {
  task: TaskItem;
  tasks: UseTasksReturn;
  renamingNode: { type: NodeType; id: string } | null;
  onRenameCommit: (name: string) => void;
  onRenameCancel: () => void;
  onContextMenu: (e: React.MouseEvent, type: NodeType, data: any) => void;
}) {
  const isActive = tasks.selectedNode?.type === "task" && tasks.selectedNode?.id === task.id;
  const isRenaming = renamingNode?.type === "task" && renamingNode?.id === task.id;
  const sc = STATUS_CONFIG[task.status] || STATUS_CONFIG.todo;

  return (
    <div
      className={`${s["task-tree-item"]} ${s["task-tree-task"]}${isActive ? ` ${s.active}` : ""}`}
      onClick={() => tasks.selectNode("task", task.id)}
      onContextMenu={(e) => onContextMenu(e, "task", task)}
    >
      <span className={s["task-tree-icon"]} title={sc.label}>
        {task.status === "docs" ? (
          <MemoIcon size={16} color={sc.color} />
        ) : (
          <span className={s["task-status-dot"]} style={{ background: sc.color }} />
        )}
      </span>
      {isRenaming ? (
        <InlineRename
          initialValue={task.name}
          onCommit={onRenameCommit}
          onCancel={onRenameCancel}
        />
      ) : (
        <span className={s["task-tree-name"]}>{task.name}</span>
      )}
      {task._cachedTimeSeconds ? (
        <span className={s["task-tree-time"]}>{formatTime(task._cachedTimeSeconds)}</span>
      ) : null}
    </div>
  );
}

// =========================================================
// Helpers
// =========================================================

function formatTime(seconds: number): string {
  if (!seconds) return "";
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h${mins > 0 ? `${mins}m` : ""}`;
  return `${mins}m`;
}
