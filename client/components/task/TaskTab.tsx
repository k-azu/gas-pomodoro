/**
 * TaskTab — Task sidebar tree + content panel
 */
import { useState, useCallback } from "react";
import { useTasks, STATUS_CONFIG } from "../../hooks/useTasks";
import type { EditableNodeType, ProjectItem, CaseItem, TaskItem } from "../../hooks/useTasks";
import { ContextMenu } from "../shared/ContextMenu";
import type { ContextMenuSection } from "../shared/ContextMenu";
import { SidebarShell, SidebarAddButton } from "../shared/SidebarShell";
import { ContentHeader } from "../shared/ContentHeader";
import { SaveOverlay } from "../shared/SaveOverlay";
import { CreateDocumentModal, type CreateDocumentType } from "../shared/CreateDocumentModal";
import { TaskTree } from "./TaskTree";
import { TaskContent } from "./TaskContent";
import { useSidebarWidth } from "../../hooks/useSidebarWidth";
import { STORAGE_KEYS, lsGet, lsSet } from "../../lib/localStorage";
import s from "./TaskTab.module.css";

const SIDEBAR_KEY = STORAGE_KEYS.TASK_SIDEBAR_COLLAPSED;

type CreateModalTarget =
  | { kind: "project" }
  | { kind: "project-child"; projectId: string; parentName: string }
  | { kind: "case-task"; projectId: string; caseId: string; parentName: string };

export function TaskTab({
  standalone = false,
  documentNode,
}: {
  standalone?: boolean;
  documentNode?: { type: "project" | "case" | "task"; id: string };
} = {}) {
  const tasks = useTasks();
  const sidebarWidth = useSidebarWidth(STORAGE_KEYS.TASK_SIDEBAR_WIDTH);
  const displayedTasks = documentNode ? { ...tasks, selectedNode: documentNode } : tasks;
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => lsGet(SIDEBAR_KEY) === "1");
  const [renamingNode, setRenamingNode] = useState<{ type: EditableNodeType; id: string } | null>(
    null,
  );
  const [contextMenu, setContextMenu] = useState<{
    pos: { x: number; y: number };
    type: EditableNodeType;
    data: ProjectItem | CaseItem | TaskItem;
  } | null>(null);
  const [createModalTarget, setCreateModalTarget] = useState<CreateModalTarget | null>(null);

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      lsSet(SIDEBAR_KEY, next ? "1" : "");
      return next;
    });
  }, []);

  // Context menu handler
  const handleContextMenu = useCallback(
    (e: React.MouseEvent, type: EditableNodeType, data: ProjectItem | CaseItem | TaskItem) => {
      e.preventDefault();
      e.stopPropagation();
      setContextMenu({ pos: { x: e.clientX, y: e.clientY }, type, data });
    },
    [],
  );

  const openCreateUnderProject = useCallback(
    (projectId: string) => {
      const project = tasks.projects.find((item) => item.id === projectId);
      if (!project) return;
      setCreateModalTarget({
        kind: "project-child",
        projectId,
        parentName: project.name,
      });
    },
    [tasks.projects],
  );

  const openCreateUnderCase = useCallback(
    (projectId: string, caseId: string) => {
      const caseItem = tasks.allCases.find((item) => item.id === caseId);
      if (!caseItem) return;
      setCreateModalTarget({
        kind: "case-task",
        projectId,
        caseId,
        parentName: caseItem.name,
      });
    },
    [tasks.allCases],
  );

  // Build context menu sections
  const contextMenuSections: ContextMenuSection[] = contextMenu
    ? [
        {
          items: [
            {
              label: "名前変更",
              onClick: () => setRenamingNode({ type: contextMenu.type, id: contextMenu.data.id }),
            },
            ...(contextMenu.type === "project"
              ? [
                  {
                    label: "新規作成",
                    onClick: () => openCreateUnderProject(contextMenu.data.id),
                  },
                ]
              : []),
            ...(contextMenu.type === "case"
              ? [
                  {
                    label: "タスクを追加",
                    onClick: () =>
                      openCreateUnderCase(
                        (contextMenu.data as CaseItem).projectId,
                        contextMenu.data.id,
                      ),
                  },
                ]
              : []),
          ],
        },
        ...(contextMenu.type === "task"
          ? [
              {
                title: "ステータス",
                items: Object.entries(STATUS_CONFIG).map(([key, cfg]) => ({
                  label: cfg.label,
                  dotColor: cfg.color,
                  checked: (contextMenu.data as TaskItem).status === key,
                  onClick: () => tasks.updateTaskFields(contextMenu.data.id, { status: key }),
                })),
              },
            ]
          : []),
        {
          items: [
            {
              label: "アーカイブ",
              danger: true,
              onClick: () => {
                tasks.archiveNode(contextMenu.type, contextMenu.data.id);
              },
            },
          ],
        },
      ]
    : [];

  // Rename commit
  const handleRenameCommit = useCallback(
    (name: string) => {
      if (renamingNode) {
        tasks.rename(renamingNode.type, renamingNode.id, name);
        setRenamingNode(null);
      }
    },
    [renamingNode, tasks],
  );

  return (
    <div
      className={`${s["task-tab-layout"]}${standalone ? ` ${s.standalone}` : ""}`}
      aria-busy={tasks.isLoading}
    >
      <SaveOverlay visible={tasks.isLoading} label="文書を処理中..." />
      {/* Sidebar */}
      {!standalone && (
        <SidebarShell
          collapsed={sidebarCollapsed}
          onToggle={toggleSidebar}
          width={sidebarWidth.width}
          onWidthChange={sidebarWidth.onWidthChange}
          onWidthChangeEnd={sidebarWidth.onWidthChangeEnd}
          headerSlot={
            <SidebarAddButton
              disabled={tasks.isLoading}
              onClick={() => setCreateModalTarget({ kind: "project" })}
              ariaLabel="プロジェクトを新規作成"
              title="プロジェクトを新規作成"
            >
              +
            </SidebarAddButton>
          }
          isEmpty={tasks.projects.length === 0}
          emptyMessage="プロジェクトがありません"
        >
          <TaskTree
            tasks={tasks}
            renamingNode={renamingNode}
            onRenameCommit={handleRenameCommit}
            onRenameCancel={() => setRenamingNode(null)}
            onContextMenu={handleContextMenu}
            onCreateUnderProject={openCreateUnderProject}
            onCreateUnderCase={openCreateUnderCase}
          />
        </SidebarShell>
      )}

      {/* Content */}
      <div className={s["task-content-area"]}>
        {displayedTasks.selectedNode ? (
          <TaskContent
            tasks={displayedTasks}
            sidebarCollapsed={sidebarCollapsed}
            onExpandSidebar={toggleSidebar}
            standalone={standalone}
            onCreateUnderProject={openCreateUnderProject}
            onCreateUnderCase={openCreateUnderCase}
          />
        ) : (
          <ContentHeader
            sidebarCollapsed={sidebarCollapsed}
            onExpandSidebar={toggleSidebar}
            emptyMessage="プロジェクトまたはタスクを選択してください"
          />
        )}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <ContextMenu
          position={contextMenu.pos}
          sections={contextMenuSections}
          onClose={() => setContextMenu(null)}
        />
      )}
      {createModalTarget && (
        <CreateDocumentModal
          title={
            createModalTarget.kind === "project"
              ? "プロジェクトを新規作成"
              : createModalTarget.kind === "project-child"
                ? `「${createModalTarget.parentName}」に新規作成`
                : `「${createModalTarget.parentName}」にタスクを作成`
          }
          allowedTypes={
            createModalTarget.kind === "project"
              ? ["project"]
              : createModalTarget.kind === "project-child"
                ? ["case", "task"]
                : ["task"]
          }
          onClose={() => setCreateModalTarget(null)}
          onSubmit={(type: CreateDocumentType, name: string) => {
            if (createModalTarget.kind === "project") return tasks.addProject(name);
            if (createModalTarget.kind === "project-child") {
              return type === "case"
                ? tasks.addCase(createModalTarget.projectId, name)
                : tasks.addTask(createModalTarget.projectId, "", name);
            }
            return tasks.addTask(createModalTarget.projectId, createModalTarget.caseId, name);
          }}
        />
      )}
    </div>
  );
}
