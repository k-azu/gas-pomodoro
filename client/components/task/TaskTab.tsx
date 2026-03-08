/**
 * TaskTab — Task sidebar tree + content panel
 */
import { useState, useCallback } from "react";
import { useTasks, STATUS_CONFIG, STATUS_ITEMS, statusLabelToKey } from "../../hooks/useTasks";
import type { NodeType, ProjectItem, CaseItem, TaskItem } from "../../hooks/useTasks";
import { ContextMenu } from "../shared/ContextMenu";
import type { ContextMenuSection } from "../shared/ContextMenu";
import { SidebarShell, SidebarAddButton } from "../shared/SidebarShell";
import { ContentHeader } from "../shared/ContentHeader";
import { TaskTree } from "./TaskTree";
import { TaskContent } from "./TaskContent";
import { lsGet, lsSet } from "../../lib/localStorage";
import s from "./TaskTab.module.css";

const SIDEBAR_KEY = "gas_pomodoro_task_sidebar_collapsed";

export function TaskTab() {
  const tasks = useTasks();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => lsGet(SIDEBAR_KEY) === "1");
  const [renamingNode, setRenamingNode] = useState<{ type: NodeType; id: string } | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    pos: { x: number; y: number };
    type: NodeType;
    data: ProjectItem | CaseItem | TaskItem;
  } | null>(null);

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      lsSet(SIDEBAR_KEY, next ? "1" : "");
      return next;
    });
  }, []);

  // Context menu handler
  const handleContextMenu = useCallback(
    (e: React.MouseEvent, type: NodeType, data: ProjectItem | CaseItem | TaskItem) => {
      e.preventDefault();
      e.stopPropagation();
      setContextMenu({ pos: { x: e.clientX, y: e.clientY }, type, data });
    },
    [],
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
                    label: "案件を追加",
                    onClick: () => {
                      const name = prompt("案件名:");
                      if (name?.trim()) {
                        tasks.addCase(contextMenu.data.id, name.trim());
                      }
                    },
                  },
                  {
                    label: "タスクを追加",
                    onClick: () => {
                      const name = prompt("タスク名:");
                      if (name?.trim()) {
                        tasks.addTask(contextMenu.data.id, "", name.trim());
                      }
                    },
                  },
                ]
              : []),
            ...(contextMenu.type === "case"
              ? [
                  {
                    label: "タスクを追加",
                    onClick: () => {
                      const name = prompt("タスク名:");
                      if (name?.trim()) {
                        tasks.addTask(
                          (contextMenu.data as CaseItem).projectId,
                          contextMenu.data.id,
                          name.trim(),
                        );
                      }
                    },
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
    <div className={s["task-tab-layout"]}>
      {/* Sidebar */}
      <SidebarShell
        collapsed={sidebarCollapsed}
        onToggle={toggleSidebar}
        headerSlot={
          <SidebarAddButton
            onClick={() => {
              const name = prompt("プロジェクト名:");
              if (name?.trim()) tasks.addProject(name.trim());
            }}
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
        />
      </SidebarShell>

      {/* Content */}
      <div className={s["task-content-area"]}>
        {tasks.selectedNode ? (
          <TaskContent
            tasks={tasks}
            sidebarCollapsed={sidebarCollapsed}
            onExpandSidebar={toggleSidebar}
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
    </div>
  );
}
