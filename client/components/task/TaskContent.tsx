/**
 * TaskContent — Content area for project/case/task
 *
 * Single editor instance shared across all node types.
 * Meta section (name, status, dates, etc.) varies per type via keyed child components.
 * Tiptap undo history and cursor position are preserved across type switches.
 */
import { useState, useCallback, useEffect, useRef } from "react";
import type { UseTasksReturn } from "../../hooks/useTasks";
import { STATUS_CONFIG, STATUS_ITEMS_WITH_ARCHIVED, statusLabelToKey } from "../../hooks/useTasks";
import { useDocumentEditor } from "../../hooks/useDocumentEditor";
import { useEditorConfig } from "../../hooks/useEditorConfig";
import { useTaskRecordCache } from "../../hooks/useTaskRecordCache";
import { useApp } from "../../contexts/AppContext";
import { useNavigation } from "../../contexts/NavigationContext";
import type { ViewerState } from "../../contexts/NavigationContext";
import { ItemPicker } from "../shared/ItemPicker";
import { ContentHeaderName } from "../shared/ContentHeader";
import { FolderIcon } from "../shared/Icons";
import { SidebarExpandButton } from "../shared/Sidebar";
import { RecordField } from "../shared/RecordField";
import { RecordRow } from "../shared/RecordRow";
import { EditorLayout, ToolbarSlot, MetaTitle } from "../shared/EditorLayout";
import { SyncIndicator, type SyncStatus } from "../shared/SyncIndicator";
import { TaskTableView } from "./TaskTableView";
import s from "./TaskContent.module.css";
import * as TaskStore from "../../lib/taskStore";
import * as EntityStore from "../../lib/entityStore";

interface TaskContentProps {
  tasks: UseTasksReturn;
  sidebarCollapsed?: boolean;
  onExpandSidebar?: () => void;
}

function storeNameFor(type: string): string {
  if (type === "case") return "cases";
  if (type === "task") return "tasks";
  return "projects";
}

export function TaskContent({ tasks, sidebarCollapsed, onExpandSidebar }: TaskContentProps) {
  const { selectedNode } = tasks;
  const editorConfig = useEditorConfig();
  if (!selectedNode) return null;

  const id = selectedNode.id;
  const type = selectedNode.type;
  const storeName = storeNameFor(type);
  const isContainerType = type === "project" || type === "case";
  const showingDoc = isContainerType ? (tasks.viewModes[id] || "doc") !== "table" : true;

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
    flushPendingSave,
  } = useDocumentEditor({
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

  // --- Toggle view (project/case only) ---
  const toggleView = useCallback(() => {
    flushPendingSave();
    tasks.setViewMode(id, showingDoc ? "table" : "doc");
  }, [id, showingDoc, tasks, flushPendingSave]);

  // --- Toolbar slots ---
  const toolbarLeftSlot =
    sidebarCollapsed && onExpandSidebar ? (
      <ToolbarSlot>
        <SidebarExpandButton onClick={onExpandSidebar} />
      </ToolbarSlot>
    ) : undefined;

  const toolbarRightSlot = isContainerType ? (
    <ToolbarSlot>
      <ViewModeToggle showingDoc={showingDoc} toggleView={toggleView} />
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
        readOnly={readOnly}
        onImageUpload={editorConfig.editorProps.onImageUpload}
        scrollRef={scrollRef}
        toolbarLeft={toolbarLeftSlot}
        toolbarRight={toolbarRightSlot}
        className={s["task-wiki-container"]}
        afterMeta={tableSlot}
      >
        {/* Meta section — keyed to remount per type+id */}
        {type === "project" && (
          <ProjectMeta key={`p-${id}`} id={id} tasks={tasks} syncStatus={syncStatus} />
        )}
        {type === "case" && (
          <CaseMeta key={`c-${id}`} id={id} tasks={tasks} syncStatus={syncStatus} />
        )}
        {type === "task" && (
          <TaskMeta key={`t-${id}`} id={id} tasks={tasks} syncStatus={syncStatus} />
        )}
      </EditorLayout>

      {/* Work records — task only */}
      {type === "task" && <TaskWorkRecords key={id} id={id} />}
    </div>
  );
}

// =========================================================
// Meta Components
// =========================================================

function useEntity(storeName: string, entityType: string, id: string) {
  const [entity, setEntity] = useState<any>(null);

  useEffect(() => {
    EntityStore.get(storeName, id).then((data) => setEntity(data));
  }, [storeName, id]);

  useEffect(() => {
    const handler = (detail: { entityType?: string }) => {
      if (!detail || detail.entityType === entityType || detail.entityType === "all") {
        EntityStore.get(storeName, id).then((data) => {
          if (data) setEntity(data);
        });
      }
    };
    EntityStore.on("dataChanged", handler);
    return () => EntityStore.off("dataChanged", handler);
  }, [entityType, storeName, id]);

  return [entity, setEntity] as const;
}

function ViewModeToggle({
  showingDoc,
  toggleView,
}: {
  showingDoc: boolean;
  toggleView: () => void;
}) {
  return (
    <button type="button" className={s["view-mode-btn"]} onClick={toggleView}>
      {showingDoc ? "タスク一覧" : "ドキュメント"}
    </button>
  );
}

function ProjectMeta({
  id,
  tasks,
  syncStatus,
}: {
  id: string;
  tasks: UseTasksReturn;
  syncStatus: SyncStatus;
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
            colorRef.current?.click();
          }}
        >
          <FolderIcon size={24} color={entity.color || "#4285f4"} />
          <input
            ref={colorRef}
            type="color"
            value={entity.color || "#4285f4"}
            onChange={(e) => tasks.updateProjectFields(id, { color: e.target.value })}
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
}: {
  id: string;
  tasks: UseTasksReturn;
  syncStatus: SyncStatus;
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
}: {
  id: string;
  tasks: UseTasksReturn;
  syncStatus: SyncStatus;
}) {
  const [entity, setEntity] = useEntity("tasks", "task", id);

  if (!entity) return null;

  const sc = STATUS_CONFIG[entity.status] || STATUS_CONFIG.todo;

  return (
    <>
      <div className={s["meta-status-row"]}>
        <SyncIndicator status={syncStatus} />
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
          selected={[sc.label]}
          removable={false}
          onSelect={(selected) => {
            if (selected.length > 0) {
              const label = selected[0];
              if (label === "Archived") {
                tasks.updateTaskFields(id, { isActive: false });
              } else {
                const key = statusLabelToKey(label);
                tasks.updateTaskFields(id, { status: key });
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
          className={s["task-date-input"]}
          value={entity.dueDate ? entity.dueDate.slice(0, 10) : ""}
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
