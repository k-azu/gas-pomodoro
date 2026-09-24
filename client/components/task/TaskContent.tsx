/**
 * TaskContent — Content area for project/case/task
 *
 * One editor instance is mounted for the selected node. Switching documents resets
 * its state from the server-confirmed in-memory snapshot.
 */
import { useState, useCallback, useEffect } from "react";
import type { UseTasksReturn } from "../../hooks/useTasks";
import { STATUS_CONFIG, STATUS_ITEMS_WITH_ARCHIVED, statusLabelToKey } from "../../hooks/useTasks";
import { useDocumentEditor } from "../../hooks/useDocumentEditor";
import { useDocumentSearchNavigation } from "../../hooks/useDocumentSearchNavigation";
import { useEditorConfig } from "../../hooks/useEditorConfig";
import { useNavigation } from "../../contexts/NavigationContext";
import { ItemPicker } from "../shared/ItemPicker";
import { ContentHeaderName } from "../shared/ContentHeader";
import { FileIcon, FolderIcon, TaskListIcon } from "../shared/Icons";
import { SidebarExpandButton } from "../shared/Sidebar";
import { RecordField } from "../shared/RecordField";
import { EditorLayout, ToolbarSlot, MetaTitle } from "../shared/EditorLayout";
import { SyncIndicator, type SyncStatus } from "../shared/SyncIndicator";
import { DocumentSearchNavigation } from "../search/DocumentSearchNavigation";
import { DocumentContentConflict } from "../shared/DocumentContentConflict";
import { OpenDocumentWindowButton } from "../shared/OpenDocumentWindowButton";
import { ArchivedBadge } from "../shared/ArchivedBadge";
import { TaskTableView } from "./TaskTableView";
import { DUE_BEFORE_START_MESSAGE, getDueState, isDueBeforeStart } from "../../lib/taskDueState";
import s from "./TaskContent.module.css";
import * as TaskStore from "../../lib/taskStore";
import * as DocumentStore from "../../lib/documentStore";

interface TaskContentProps {
  tasks: UseTasksReturn;
  sidebarCollapsed?: boolean;
  onExpandSidebar?: () => void;
  standalone?: boolean;
  onCreateUnderProject?: (projectId: string) => void;
  onCreateUnderCase?: (projectId: string, caseId: string) => void;
}

function storeNameFor(type: string): string {
  if (type === "case") return "cases";
  if (type === "task") return "tasks";
  return "projects";
}

export function TaskContent({
  tasks,
  sidebarCollapsed,
  onExpandSidebar,
  standalone = false,
  onCreateUnderProject,
  onCreateUnderCase,
}: TaskContentProps) {
  const { selectedNode } = tasks;
  if (!selectedNode) return null;
  if (selectedNode.type === "all") {
    return (
      <AllTasksContent
        tasks={tasks}
        sidebarCollapsed={sidebarCollapsed}
        onExpandSidebar={onExpandSidebar}
      />
    );
  }

  return (
    <TaskDocumentContent
      tasks={tasks}
      sidebarCollapsed={sidebarCollapsed}
      onExpandSidebar={onExpandSidebar}
      standalone={standalone}
      onCreateUnderProject={onCreateUnderProject}
      onCreateUnderCase={onCreateUnderCase}
    />
  );
}

function AllTasksContent({ tasks, sidebarCollapsed, onExpandSidebar }: TaskContentProps) {
  return (
    <div className={s["task-detail"]}>
      <div className={s["all-tasks-header"]}>
        {sidebarCollapsed && onExpandSidebar && <SidebarExpandButton onClick={onExpandSidebar} />}
        <span className={s["all-tasks-header-icon"]}>
          <TaskListIcon size={20} color="#1976d2" />
        </span>
        <h2>全タスク</h2>
      </div>
      <div className={s["all-tasks-body"]}>
        <TaskTableView tasks={tasks} parentType="all" parentId="all" />
      </div>
    </div>
  );
}

function TaskDocumentContent({
  tasks,
  sidebarCollapsed,
  onExpandSidebar,
  standalone = false,
  onCreateUnderProject,
  onCreateUnderCase,
}: TaskContentProps) {
  const { selectedNode } = tasks;
  const nav = useNavigation();
  const editorConfig = useEditorConfig();
  if (!selectedNode || selectedNode.type === "all") return null;

  const id = selectedNode.id;
  const type = selectedNode.type;
  const storeName = storeNameFor(type);
  const isContainerType = type === "project" || type === "case";
  const showingDoc = standalone || (isContainerType ? tasks.taskViewMode !== "table" : true);
  const selectedEntity = DocumentStore.get(storeName as DocumentStore.DocumentStoreName, id);
  const selectedRecord = selectedEntity as unknown as Record<string, unknown> | null;
  const projectId = String(selectedRecord?.projectId ?? "");
  const caseId = String(selectedRecord?.caseId ?? "");
  const hiddenByArchivedParent =
    (projectId && DocumentStore.get("projects", projectId)?.isActive === false) ||
    (caseId && DocumentStore.get("cases", caseId)?.isActive === false);
  const selfArchived = selectedEntity?.isActive === false;
  const isArchivedDocument =
    selfArchived ||
    Boolean(hiddenByArchivedParent) ||
    (nav.searchOpenedDocument?.type === type &&
      nav.searchOpenedDocument.id === id &&
      nav.searchOpenedDocument.isArchived);

  const restoreSelected = () => {
    if (type === "project") void tasks.unarchiveProject(id);
    else if (type === "case") void tasks.unarchiveCase(id);
    else void tasks.unarchiveTask(id);
  };
  // Only the document's own archive can be undone here; an archived parent is restored from it.
  const archiveBadge = isArchivedDocument ? (
    <ArchivedBadge
      onRestore={selfArchived ? restoreSelected : undefined}
      title={selfArchived ? undefined : "親のプロジェクトまたは案件がアーカイブされています"}
    />
  ) : null;

  // --- Single useDocumentEditor instance ---
  const {
    editor,
    mode,
    setMode,
    rawMarkdown,
    setRawMarkdown,
    charCount,
    scrollRef,
    readOnly,
    syncStatus,
    retrySync,
    contentRevision,
    flushPendingSave,
    contentConflict,
    keepLocalConflict,
    acceptRemoteConflict,
    handoffEditLease,
    canOpenInNewTab,
    savingForTransition,
  } = useDocumentEditor({
    editorKey: "task",
    scope: storeName,
    id,
    loadContent: useCallback((id: string) => TaskStore.getContent(id, storeName), [storeName]),
    saveContent: useCallback(
      (id: string, md: string, opts?: { immediateSync?: boolean }) =>
        TaskStore.saveContent(id, md, storeName, opts),
      [storeName],
    ),
    flushSync: useCallback((id: string) => TaskStore.flushContentSync(storeName, id), [storeName]),
    resolveContent: useCallback(
      (id: string) => TaskStore.resolveWithServer(id, storeName),
      [storeName],
    ),
    ...editorConfig.editorProps,
    ...editorConfig.hookOptions,
    hasAfterMeta: !showingDoc && isContainerType,
  });

  // A project/case opened from search must show its document so matches can be revealed.
  const revealRequestedHere =
    nav.searchRevealRequest?.tab === "task" && nav.searchRevealRequest.id === id;
  const { taskViewMode, setTaskViewMode } = tasks;
  useEffect(() => {
    if (revealRequestedHere && isContainerType && !standalone && taskViewMode === "table") {
      setTaskViewMode("doc");
    }
  }, [revealRequestedHere, isContainerType, standalone, taskViewMode, setTaskViewMode]);

  const searchNavigation = useDocumentSearchNavigation({
    tab: "task",
    id,
    editor,
    mode,
    rawMarkdown,
    contentRevision,
    scrollRef,
  });

  // --- Toggle view (project/case only) ---
  const toggleView = useCallback(async () => {
    if (!(await flushPendingSave())) return;
    tasks.setTaskViewMode(showingDoc ? "table" : "doc");
  }, [showingDoc, tasks, flushPendingSave]);

  const toggleTableLayout = useCallback(() => {
    tasks.setTableLayoutMode(tasks.tableLayoutMode === "grouped" ? "flat" : "grouped");
  }, [tasks]);

  // --- Toolbar slots ---
  const toolbarLeftSlot =
    !standalone && sidebarCollapsed && onExpandSidebar ? (
      <ToolbarSlot>
        <SidebarExpandButton onClick={onExpandSidebar} />
      </ToolbarSlot>
    ) : undefined;

  const toolbarRightSlot =
    !standalone && (isContainerType || canOpenInNewTab) ? (
      <ToolbarSlot>
        {isContainerType && (
          <ViewModeToggle
            showingDoc={showingDoc}
            tableLayoutMode={tasks.tableLayoutMode}
            toggleView={() => void toggleView()}
            toggleTableLayout={toggleTableLayout}
          />
        )}
        <OpenDocumentWindowButton
          target={{ tab: "task", taskNode: { type, id } }}
          onBeforeOpen={handoffEditLease}
          disabled={!canOpenInNewTab}
        />
      </ToolbarSlot>
    ) : undefined;

  const tableSlot =
    !showingDoc && isContainerType ? (
      <TaskTableView
        tasks={tasks}
        parentType={type as "project" | "case"}
        parentId={id}
        onCreateUnderProject={onCreateUnderProject}
        onCreateUnderCase={onCreateUnderCase}
      />
    ) : undefined;

  return (
    <div className={s["task-detail"]}>
      <EditorLayout
        editor={editor}
        mode={mode}
        setMode={setMode}
        rawMarkdown={rawMarkdown}
        setRawMarkdown={setRawMarkdown}
        charCount={charCount}
        maxCharCount={50000}
        placeholder="ドキュメントを入力..."
        readOnly={readOnly}
        onImageUpload={editorConfig.editorProps.onImageUpload}
        scrollRef={scrollRef}
        saving={savingForTransition && !tasks.isLoading}
        toolbarLeft={toolbarLeftSlot}
        toolbarRight={toolbarRightSlot}
        searchNavigation={
          searchNavigation ? <DocumentSearchNavigation controller={searchNavigation} /> : undefined
        }
        className={s["task-wiki-container"]}
        afterMeta={tableSlot}
      >
        <DocumentContentConflict
          conflict={contentConflict}
          onKeepLocal={keepLocalConflict}
          onAcceptRemote={acceptRemoteConflict}
        />
        {/* Meta section — keyed to remount per type+id */}
        {type === "project" && (
          <ProjectMeta
            key={`p-${id}`}
            id={id}
            tasks={tasks}
            syncStatus={syncStatus}
            onRetrySync={retrySync}
            archiveBadge={archiveBadge}
          />
        )}
        {type === "case" && (
          <CaseMeta
            key={`c-${id}`}
            id={id}
            tasks={tasks}
            syncStatus={syncStatus}
            onRetrySync={retrySync}
            archiveBadge={archiveBadge}
          />
        )}
        {type === "task" && (
          <TaskMeta
            key={`t-${id}`}
            id={id}
            tasks={tasks}
            syncStatus={syncStatus}
            onRetrySync={retrySync}
            archiveBadge={archiveBadge}
          />
        )}
      </EditorLayout>
    </div>
  );
}

// =========================================================
// Meta Components
// =========================================================

function useEntity(storeName: string, entityType: string, id: string) {
  const [entity, setEntity] = useState<any>(null);

  useEffect(() => {
    setEntity(DocumentStore.get(storeName as DocumentStore.DocumentStoreName, id));
  }, [storeName, id]);

  useEffect(() => {
    const handler = (detail: { entityType?: string }) => {
      if (!detail || detail.entityType === entityType || detail.entityType === "all") {
        const data = DocumentStore.get(storeName as DocumentStore.DocumentStoreName, id);
        if (data) setEntity(data);
      }
    };
    DocumentStore.on(handler);
    return () => DocumentStore.off(handler);
  }, [entityType, storeName, id]);

  return [entity, setEntity] as const;
}

/** Document icon that opens a color picker; the hover ring and tooltip show it is editable. */
function MetaColorIcon({
  color,
  onChange,
  children,
}: {
  color: string;
  onChange: (color: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label className={s["meta-color-icon"]} title="色を変更">
      {children}
      <input
        type="color"
        className={s["meta-color-input"]}
        value={color}
        onChange={(e) => onChange(e.target.value)}
        aria-label="色を変更"
      />
    </label>
  );
}

function ViewModeToggle({
  showingDoc,
  tableLayoutMode,
  toggleView,
  toggleTableLayout,
}: {
  showingDoc: boolean;
  tableLayoutMode: "grouped" | "flat";
  toggleView: () => void;
  toggleTableLayout: () => void;
}) {
  return (
    <div className={s["view-mode-controls"]}>
      {!showingDoc && (
        <button type="button" className={s["view-mode-btn"]} onClick={toggleTableLayout}>
          {tableLayoutMode === "grouped" ? "グループ解除" : "グループ表示"}
        </button>
      )}
      <button type="button" className={s["view-mode-btn"]} onClick={toggleView}>
        {showingDoc ? "タスク一覧" : "ドキュメント"}
      </button>
    </div>
  );
}

function ProjectMeta({
  id,
  tasks,
  syncStatus,
  onRetrySync,
  archiveBadge,
}: {
  id: string;
  tasks: UseTasksReturn;
  syncStatus: SyncStatus;
  onRetrySync?: () => void;
  archiveBadge?: React.ReactNode;
}) {
  const [entity, setEntity] = useEntity("projects", "project", id);

  if (!entity) return null;

  const color = entity.color || "#4285f4";
  return (
    <>
      <div className={s["meta-status-row"]}>
        <MetaColorIcon
          color={color}
          onChange={(next) => tasks.updateProjectFields(id, { color: next })}
        >
          <FolderIcon size={24} color={color} />
        </MetaColorIcon>
        {archiveBadge}
        <SyncIndicator status={syncStatus} onRetry={onRetrySync} />
      </div>
      <MetaTitle>
        <ContentHeaderName
          name={entity.name}
          onRename={(name) => {
            setEntity((prev: any) => ({ ...prev, name }));
            tasks.rename("project", id, name);
          }}
        />
      </MetaTitle>
    </>
  );
}

function CaseMeta({
  id,
  tasks,
  syncStatus,
  onRetrySync,
  archiveBadge,
}: {
  id: string;
  tasks: UseTasksReturn;
  syncStatus: SyncStatus;
  onRetrySync?: () => void;
  archiveBadge?: React.ReactNode;
}) {
  const [entity, setEntity] = useEntity("cases", "case", id);

  if (!entity) return null;

  return (
    <>
      <div className={s["meta-status-row"]}>
        <MetaColorIcon
          color={entity.color || "#757575"}
          onChange={(next) => tasks.updateCaseFields(id, { color: next })}
        >
          <FileIcon size={22} color={entity.color || "#757575"} />
        </MetaColorIcon>
        {archiveBadge}
        <SyncIndicator status={syncStatus} onRetry={onRetrySync} />
      </div>
      <MetaTitle>
        <ContentHeaderName
          name={entity.name}
          onRename={(name) => {
            setEntity((prev: any) => ({ ...prev, name }));
            tasks.rename("case", id, name);
          }}
        />
      </MetaTitle>
    </>
  );
}

function TaskMeta({
  id,
  tasks,
  syncStatus,
  onRetrySync,
  archiveBadge,
}: {
  id: string;
  tasks: UseTasksReturn;
  syncStatus: SyncStatus;
  onRetrySync?: () => void;
  archiveBadge?: React.ReactNode;
}) {
  const [entity, setEntity] = useEntity("tasks", "task", id);

  if (!entity) return null;

  const sc = STATUS_CONFIG[entity.status] || STATUS_CONFIG.todo;
  const dueState = getDueState(entity);
  const dueBeforeStart = isDueBeforeStart(entity);

  return (
    <>
      <div className={s["meta-status-row"]}>
        {archiveBadge}
        <SyncIndicator status={syncStatus} onRetry={onRetrySync} />
      </div>
      <MetaTitle>
        <ContentHeaderName
          name={entity.name}
          onRename={(name) => {
            setEntity((prev: any) => ({ ...prev, name }));
            tasks.rename("task", id, name);
          }}
        />
      </MetaTitle>
      <RecordField label="ステータス">
        <ItemPicker
          mode="single"
          items={STATUS_ITEMS_WITH_ARCHIVED}
          selected={[entity.isActive === false ? "Archived" : sc.label]}
          removable={false}
          onSelect={(selected) => {
            if (selected.length > 0) {
              const label = selected[0];
              if (label === "Archived") {
                void tasks.archiveNode("task", id);
              } else {
                const key = statusLabelToKey(label);
                if (entity.isActive === false) {
                  void tasks.unarchiveTask(id, key);
                } else {
                  tasks.updateTaskFields(id, { status: key });
                }
              }
            }
          }}
          placeholder="ステータス"
        />
      </RecordField>
      <RecordField label="開始">
        <input
          type="date"
          className={s["task-date-input"]}
          value={entity.startedAt ? entity.startedAt.slice(0, 10) : ""}
          onChange={(e) => tasks.updateTaskFields(id, { startedAt: e.target.value || "" })}
        />
      </RecordField>
      <RecordField label="期限">
        <input
          type="date"
          className={`${s["task-date-input"]}${
            dueBeforeStart
              ? ` ${s["due-invalid"]}`
              : dueState
                ? ` ${s[dueState === "overdue" ? "due-overdue" : "due-today"]}`
                : ""
          }`}
          value={entity.dueDate ? entity.dueDate.slice(0, 10) : ""}
          onChange={(e) => tasks.updateTaskFields(id, { dueDate: e.target.value || "" })}
          aria-invalid={dueBeforeStart || undefined}
        />
        {dueBeforeStart ? (
          <span className={s["due-note-error"]} role="alert">
            {DUE_BEFORE_START_MESSAGE}
          </span>
        ) : dueState === "overdue" ? (
          <span className={s["due-note-error"]}>期限切れ</span>
        ) : dueState === "today" ? (
          <span className={s["due-note-today"]}>今日が期限</span>
        ) : null}
      </RecordField>
    </>
  );
}
