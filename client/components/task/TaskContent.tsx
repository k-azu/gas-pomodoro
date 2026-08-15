/**
 * TaskContent — Content area for project/case/task
 *
 * One editor instance is mounted for the selected node. Switching documents resets
 * its state from the server-confirmed in-memory snapshot.
 */
import { useState, useCallback, useEffect, useRef } from "react";
import type { UseTasksReturn } from "../../hooks/useTasks";
import { STATUS_CONFIG, STATUS_ITEMS_WITH_ARCHIVED, statusLabelToKey } from "../../hooks/useTasks";
import { useDocumentEditor } from "../../hooks/useDocumentEditor";
import { useDocumentSearchNavigation } from "../../hooks/useDocumentSearchNavigation";
import { useEditorConfig } from "../../hooks/useEditorConfig";
import { useTaskRecordCache } from "../../hooks/useTaskRecordCache";
import { useApp } from "../../contexts/AppContext";
import { useNavigation } from "../../contexts/NavigationContext";
import type { ViewerState } from "../../contexts/NavigationContext";
import { ItemPicker } from "../shared/ItemPicker";
import { ContentHeaderName } from "../shared/ContentHeader";
import { FolderIcon, TaskListIcon } from "../shared/Icons";
import { SidebarExpandButton } from "../shared/Sidebar";
import { RecordField } from "../shared/RecordField";
import { RecordRow } from "../shared/RecordRow";
import { EditorLayout, ToolbarSlot, MetaTitle } from "../shared/EditorLayout";
import { SyncIndicator, type SyncStatus } from "../shared/SyncIndicator";
import { DocumentSearchNavigation } from "../search/DocumentSearchNavigation";
import { DocumentContentConflict } from "../shared/DocumentContentConflict";
import { OpenDocumentWindowButton } from "../shared/OpenDocumentWindowButton";
import { TaskTableView } from "./TaskTableView";
import s from "./TaskContent.module.css";
import * as TaskStore from "../../lib/taskStore";
import * as DocumentStore from "../../lib/documentStore";

interface TaskContentProps {
  tasks: UseTasksReturn;
  sidebarCollapsed?: boolean;
  onExpandSidebar?: () => void;
  standalone?: boolean;
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
        <div>
          <h2>全タスク</h2>
          <p>全プロジェクトの未完了タスクを優先度順に表示します</p>
        </div>
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
  const isArchivedSearchDocument =
    selectedEntity?.isActive === false ||
    (type === "task" &&
      nav.searchOpenedDocument?.type === "task" &&
      nav.searchOpenedDocument.id === id &&
      nav.searchOpenedDocument.isArchived);

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
    contentRevision,
    flushPendingSave,
    contentConflict,
    keepLocalConflict,
    acceptRemoteConflict,
    handoffEditLease,
    canOpenInNewTab,
    savingForTransition,
  } = useDocumentEditor({
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
    forceReadOnly: isArchivedSearchDocument,
    navigationActive: standalone || nav.activeTab === "task",
    hasAfterMeta: !showingDoc && isContainerType,
  });

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
      <TaskTableView tasks={tasks} parentType={type as "project" | "case"} parentId={id} />
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
        readOnly={readOnly || isArchivedSearchDocument}
        onImageUpload={editorConfig.editorProps.onImageUpload}
        scrollRef={scrollRef}
        saving={savingForTransition}
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
            readOnly={isArchivedSearchDocument}
          />
        )}
        {type === "case" && (
          <CaseMeta
            key={`c-${id}`}
            id={id}
            tasks={tasks}
            syncStatus={syncStatus}
            readOnly={isArchivedSearchDocument}
          />
        )}
        {type === "task" && (
          <TaskMeta
            key={`t-${id}`}
            id={id}
            tasks={tasks}
            syncStatus={syncStatus}
            readOnly={isArchivedSearchDocument}
          />
        )}
      </EditorLayout>

      {/* Work records — task only */}
      {type === "task" && !standalone && !isArchivedSearchDocument && (
        <TaskWorkRecords key={id} id={id} />
      )}
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
  readOnly = false,
}: {
  id: string;
  tasks: UseTasksReturn;
  syncStatus: SyncStatus;
  readOnly?: boolean;
}) {
  const [entity, setEntity] = useEntity("projects", "project", id);
  const colorRef = useRef<HTMLInputElement>(null);

  if (!entity) return null;

  return (
    <>
      <div className={s["meta-status-row"]}>
        <span
          className={s["meta-color-folder"]}
          onClick={(e) => {
            e.stopPropagation();
            if (readOnly) return;
            colorRef.current?.click();
          }}
        >
          <FolderIcon size={24} color={entity.color || "#4285f4"} />
          <input
            ref={colorRef}
            type="color"
            value={entity.color || "#4285f4"}
            onChange={(e) => tasks.updateProjectFields(id, { color: e.target.value })}
            disabled={readOnly}
            style={{
              position: "absolute",
              inset: 0,
              opacity: 0,
              cursor: "pointer",
              width: "100%",
              height: "100%",
            }}
          />
        </span>
        <SyncIndicator status={syncStatus} />
      </div>
      <MetaTitle>
        <ContentHeaderName
          name={entity.name}
          onRename={
            readOnly
              ? undefined
              : (name) => {
                  setEntity((prev: any) => ({ ...prev, name }));
                  tasks.rename("project", id, name);
                }
          }
        />
      </MetaTitle>
    </>
  );
}

function CaseMeta({
  id,
  tasks,
  syncStatus,
  readOnly = false,
}: {
  id: string;
  tasks: UseTasksReturn;
  syncStatus: SyncStatus;
  readOnly?: boolean;
}) {
  const [entity, setEntity] = useEntity("cases", "case", id);

  if (!entity) return null;

  return (
    <>
      <div className={s["meta-status-row"]}>
        <SyncIndicator status={syncStatus} />
      </div>
      <MetaTitle>
        <ContentHeaderName
          name={entity.name}
          onRename={
            readOnly
              ? undefined
              : (name) => {
                  setEntity((prev: any) => ({ ...prev, name }));
                  tasks.rename("case", id, name);
                }
          }
        />
      </MetaTitle>
    </>
  );
}

function TaskMeta({
  id,
  tasks,
  syncStatus,
  readOnly = false,
}: {
  id: string;
  tasks: UseTasksReturn;
  syncStatus: SyncStatus;
  readOnly?: boolean;
}) {
  const [entity, setEntity] = useEntity("tasks", "task", id);

  if (!entity) return null;

  const sc = STATUS_CONFIG[entity.status] || STATUS_CONFIG.todo;

  return (
    <>
      <div className={s["meta-status-row"]}>
        {readOnly ? (
          <span className={s["archived-label"]}>アーカイブ済み・読み取り専用</span>
        ) : (
          <SyncIndicator status={syncStatus} />
        )}
      </div>
      <MetaTitle>
        <ContentHeaderName
          name={entity.name}
          onRename={
            readOnly
              ? undefined
              : (name) => {
                  setEntity((prev: any) => ({ ...prev, name }));
                  tasks.rename("task", id, name);
                }
          }
        />
      </MetaTitle>
      <RecordField label="ステータス">
        {readOnly ? (
          <span className={s["readonly-value"]}>{sc.label}</span>
        ) : (
          <ItemPicker
            mode="single"
            items={STATUS_ITEMS_WITH_ARCHIVED}
            selected={[sc.label]}
            removable={false}
            onSelect={(selected) => {
              if (selected.length > 0) {
                const label = selected[0];
                if (label === "Archived") {
                  void tasks.archiveNode("task", id);
                } else {
                  const key = statusLabelToKey(label);
                  tasks.updateTaskFields(id, { status: key });
                }
              }
            }}
            placeholder="ステータス"
          />
        )}
      </RecordField>
      <RecordField label="開始">
        <input
          type="date"
          className={s["task-date-input"]}
          value={entity.startedAt ? entity.startedAt.slice(0, 10) : ""}
          disabled={readOnly}
          onChange={(e) => tasks.updateTaskFields(id, { startedAt: e.target.value || "" })}
        />
      </RecordField>
      <RecordField label="期限">
        <input
          type="date"
          className={s["task-date-input"]}
          value={entity.dueDate ? entity.dueDate.slice(0, 10) : ""}
          disabled={readOnly}
          onChange={(e) => tasks.updateTaskFields(id, { dueDate: e.target.value || "" })}
        />
      </RecordField>
      {entity._cachedTimeSeconds ? (
        <RecordField label="作業時間">
          <span className={s["task-detail-time"]}>{formatTime(entity._cachedTimeSeconds)}</span>
        </RecordField>
      ) : null}
    </>
  );
}

// =========================================================
// Work Records
// =========================================================

function TaskWorkRecords({ id }: { id: string }) {
  const [entity] = useEntity("tasks", "task", id);
  const pomodoroCount: number = entity?._cachedPomodoroCount || 0;
  const { records, interruptions, isLoading } = useTaskRecordCache(id, pomodoroCount);
  const { timer } = useApp();
  const { showViewer, isViewerSaving } = useNavigation();

  const guardedShowViewer = useCallback(
    (state: ViewerState) => {
      if (isViewerSaving) return;
      showViewer(state);
    },
    [showViewer, isViewerSaving],
  );

  const categories = timer.state.categories;
  const intCategories = timer.state.interruptionCategories;

  const colorMap: Record<string, string> = {};
  categories.forEach((c) => {
    colorMap[c.name] = c.color;
  });

  // Group interruptions by pomodoroId
  const intMap: Record<string, typeof interruptions> = {};
  interruptions.forEach((i) => {
    if (!intMap[i.pomodoroId]) intMap[i.pomodoroId] = [];
    intMap[i.pomodoroId].push(i);
  });

  const workRecords = records.filter((r) => r.type === "work");

  const badge =
    pomodoroCount > 0 && pomodoroCount <= 5
      ? " " + "🍅".repeat(pomodoroCount)
      : pomodoroCount > 5
        ? ` 🍅×${pomodoroCount}`
        : "";

  return (
    <details className={s["task-records-section"]}>
      <summary>作業記録{badge}</summary>
      <div className={s["task-records-list"]}>
        {isLoading && workRecords.length === 0 && (
          <div className={s["task-records-loading"]}>読み込み中...</div>
        )}
        {!isLoading && workRecords.length === 0 && (
          <div className={s["task-records-empty"]}>作業記録がありません</div>
        )}
        {workRecords.length > 0 && (
          <ul className={s["task-records-ul"]}>
            {workRecords.map((r) => (
              <RecordRow
                key={r.id}
                record={r}
                interruptions={intMap[r.id] || []}
                colorMap={colorMap}
                intCategories={intCategories}
                showViewer={guardedShowViewer}
              />
            ))}
          </ul>
        )}
      </div>
    </details>
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
