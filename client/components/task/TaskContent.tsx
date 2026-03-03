/**
 * TaskContent — Content area for project/case/task
 *
 * Single DocumentEditor instance shared across all node types.
 * Meta section (name, status, dates, etc.) varies per type via keyed child components.
 * Tiptap undo history and cursor position are preserved across type switches.
 */
import { useState, useCallback, useEffect, useRef } from "react";
import type { UseTasksReturn } from "../../hooks/useTasks";
import { STATUS_CONFIG, STATUS_ITEMS, statusLabelToKey } from "../../hooks/useTasks";
import { useDocumentEditor } from "../../hooks/useDocumentEditor";
import { useEditorConfig } from "../../hooks/useEditorConfig";
import { ItemPicker } from "../shared/ItemPicker";
import { ContentHeaderName } from "../shared/ContentHeader";
import { SidebarExpandButton } from "../shared/Sidebar";
import { RecordField } from "../shared/RecordField";
import { DocumentEditor, ToolbarSlot, MetaTitle, pageRootClass } from "../shared/DocumentEditor";
import { SyncIndicator } from "../shared/SyncIndicator";
import { TaskTableView } from "./TaskTableView";
import s from "./TaskContent.module.css";
import * as TaskStore from "../../lib/taskStore";
import * as EntityStore from "../../lib/entityStore";
import { serverCall } from "../../lib/serverCall";

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
    editorRef,
    initialContent,
    onChange: handleEditorChange,
    syncStatus,
    readOnly,
  } = useDocumentEditor({
    id,
    loadContent: useCallback((id: string) => TaskStore.getContent(id, storeName), [storeName]),
    saveContent: useCallback(
      (id: string, md: string) => TaskStore.saveContent(id, md, storeName),
      [storeName],
    ),
    resolveContent: useCallback(
      (id: string) => TaskStore.resolveWithServer(id, storeName),
      [storeName],
    ),
    ...editorConfig.hookOptions,
  });

  // --- Toggle view (project/case only) ---
  const toggleView = useCallback(() => {
    editorRef.current?.flushSave();
    tasks.setViewMode(id, showingDoc ? "table" : "doc");
  }, [id, showingDoc, tasks, editorRef]);

  // --- Loading guard ---
  if (initialContent === null)
    return <div className={s["task-content-placeholder"]}>読み込み中...</div>;

  // --- Toolbar slots ---
  const toolbarLeftSlot =
    sidebarCollapsed && onExpandSidebar ? (
      <ToolbarSlot>
        <SidebarExpandButton onClick={onExpandSidebar} />
      </ToolbarSlot>
    ) : undefined;

  const hasRightContent = isContainerType || (syncStatus !== "idle" && syncStatus !== "synced");
  const toolbarRightSlot = hasRightContent ? (
    <ToolbarSlot>
      {isContainerType ? (
        <SyncIndicator status={syncStatus} />
      ) : (
        syncStatus !== "idle" && syncStatus !== "synced" && <SyncIndicator status={syncStatus} />
      )}
      {isContainerType && (
        <button className={s["task-view-toggle"]} onClick={toggleView}>
          {showingDoc ? "タスク" : "ドキュメント"}
        </button>
      )}
    </ToolbarSlot>
  ) : undefined;

  return (
    <div className={s["task-detail"]}>
      {/* Doc view — always mounted, hidden when table view active */}
      <div style={{ display: showingDoc ? "contents" : "none" }}>
        <DocumentEditor
          {...editorConfig.editorProps}
          initialValue={initialContent}
          documentId={id}
          onChange={handleEditorChange}
          placeholder="ドキュメントを入力..."
          editorRef={editorRef}
          readOnly={readOnly}
          toolbarLeft={toolbarLeftSlot}
          toolbarRight={toolbarRightSlot}
          className={s["task-wiki-container"]}
        >
          {/* Meta section — keyed to remount per type+id */}
          {type === "project" && <ProjectMeta key={`p-${id}`} id={id} tasks={tasks} />}
          {type === "case" && <CaseMeta key={`c-${id}`} id={id} tasks={tasks} />}
          {type === "task" && <TaskMeta key={`t-${id}`} id={id} tasks={tasks} />}
        </DocumentEditor>
      </div>

      {/* Table view — project/case only */}
      {!showingDoc && isContainerType && (
        <div className={pageRootClass}>
          <div className="mdg-editor-toolbar-row">
            {toolbarLeftSlot}
            <div style={{ flex: 1, minHeight: 38 }} />
            {toolbarRightSlot}
          </div>
          <TaskTableView tasks={tasks} parentType={type as "project" | "case"} parentId={id} />
        </div>
      )}

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

function ProjectMeta({ id, tasks }: { id: string; tasks: UseTasksReturn }) {
  const [entity, setEntity] = useEntity("projects", "project", id);
  const colorRef = useRef<HTMLInputElement>(null);

  if (!entity) return null;

  return (
    <>
      <MetaTitle>
        <ContentHeaderName
          name={entity.name}
          onRename={(name) => {
            setEntity((prev: any) => ({ ...prev, name }));
            tasks.rename("project", id, name);
          }}
          suffix={
            <span
              className={s["meta-color-dot"]}
              style={{ background: entity.color || "#4285f4" }}
              onClick={(e) => {
                e.stopPropagation();
                colorRef.current?.click();
              }}
            >
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
          }
        />
      </MetaTitle>
      {entity._cachedTimeSeconds ? (
        <RecordField label="作業時間">
          <span className={s["task-detail-time"]}>{formatTime(entity._cachedTimeSeconds)}</span>
        </RecordField>
      ) : null}
    </>
  );
}

function CaseMeta({ id, tasks }: { id: string; tasks: UseTasksReturn }) {
  const [entity, setEntity] = useEntity("cases", "case", id);

  if (!entity) return null;

  return (
    <>
      <MetaTitle>
        <ContentHeaderName
          name={entity.name}
          onRename={(name) => {
            setEntity((prev: any) => ({ ...prev, name }));
            tasks.rename("case", id, name);
          }}
        />
      </MetaTitle>
      {entity._cachedTimeSeconds ? (
        <RecordField label="作業時間">
          <span className={s["task-detail-time"]}>{formatTime(entity._cachedTimeSeconds)}</span>
        </RecordField>
      ) : null}
    </>
  );
}

function TaskMeta({ id, tasks }: { id: string; tasks: UseTasksReturn }) {
  const [entity, setEntity] = useEntity("tasks", "task", id);

  if (!entity) return null;

  const sc = STATUS_CONFIG[entity.status] || STATUS_CONFIG.todo;

  return (
    <>
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
          items={STATUS_ITEMS}
          selected={[sc.label]}
          removable={false}
          onSelect={(selected) => {
            if (selected.length > 0) {
              const key = statusLabelToKey(selected[0]);
              tasks.updateTaskFields(id, { status: key });
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
  const [recordsOpen, setRecordsOpen] = useState(false);
  const [records, setRecords] = useState<any[] | null>(null);
  const [recordsLoading, setRecordsLoading] = useState(false);

  useEffect(() => {
    if (recordsOpen && records === null) {
      setRecordsLoading(true);
      serverCall("getTaskPomodoroRecords", id)
        .then((data) => setRecords((data as any[]) || []))
        .catch(() => setRecords([]))
        .finally(() => setRecordsLoading(false));
    }
  }, [recordsOpen, records, id]);

  return (
    <details
      className={s["task-records-section"]}
      open={recordsOpen}
      onToggle={(e) => setRecordsOpen((e.target as HTMLDetailsElement).open)}
    >
      <summary>作業記録</summary>
      <div className={s["task-records-list"]}>
        {recordsLoading && <div className={s["task-records-loading"]}>読み込み中...</div>}
        {!recordsLoading && records && records.length === 0 && (
          <div className={s["task-records-empty"]}>作業記録がありません</div>
        )}
        {!recordsLoading &&
          records
            ?.filter((r) => r.type === "work")
            .map((r) => <TaskRecordRow key={r.id} record={r} />)}
      </div>
    </details>
  );
}

function TaskRecordRow({ record }: { record: any }) {
  const firstLine = (record.description || "").split("\n")[0].trim() || "(無題)";
  const durMin = Math.floor((record.actualDurationSeconds || 0) / 60);
  let dateStr = "";
  try {
    const d = new Date(record.startTime);
    dateStr = `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  } catch {
    // ignore
  }

  return (
    <div className={s["task-record-row"]}>
      <span className={s["task-record-date"]}>{dateStr}</span>
      <span className={s["task-record-desc"]}>{firstLine}</span>
      <span className={s["task-record-dur"]}>{durMin}分</span>
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
