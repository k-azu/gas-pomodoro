/**
 * TaskContent — Content area for project/case/task
 * Notion-like layout: toolbar(sticky) → meta → editor body in single scroll
 */
import { useState, useCallback, useEffect, useRef } from "react";
import type { UseTasksReturn } from "../../hooks/useTasks";
import { STATUS_CONFIG, STATUS_ITEMS, statusLabelToKey } from "../../hooks/useTasks";
import { useDocumentEditor } from "../../hooks/useDocumentEditor";
import { ItemPicker } from "../shared/ItemPicker";
import { ContentHeaderName } from "../shared/ContentHeader";
import { SidebarExpandButton } from "../shared/Sidebar";
import { RecordField } from "../shared/RecordField";
import { DocumentEditor, ToolbarSlot, MetaTitle, pageRootClass } from "../shared/DocumentEditor";
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

export function TaskContent({ tasks, sidebarCollapsed, onExpandSidebar }: TaskContentProps) {
  const { selectedNode } = tasks;
  if (!selectedNode) return null;

  if (selectedNode.type === "project" || selectedNode.type === "case") {
    return (
      <ProjectOrCaseContent
        tasks={tasks}
        type={selectedNode.type}
        id={selectedNode.id}
        sidebarCollapsed={sidebarCollapsed}
        onExpandSidebar={onExpandSidebar}
      />
    );
  }

  return (
    <TaskDetailContent
      tasks={tasks}
      id={selectedNode.id}
      sidebarCollapsed={sidebarCollapsed}
      onExpandSidebar={onExpandSidebar}
    />
  );
}

// =========================================================
// Project / Case Content
// =========================================================

function ProjectOrCaseContent({
  tasks,
  type,
  id,
  sidebarCollapsed,
  onExpandSidebar,
}: {
  tasks: UseTasksReturn;
  type: "project" | "case";
  id: string;
  sidebarCollapsed?: boolean;
  onExpandSidebar?: () => void;
}) {
  const [entity, setEntity] = useState<any>(null);
  const colorRef = useRef<HTMLInputElement>(null);
  const showingDoc = (tasks.viewModes[id] || "doc") !== "table";
  const storeName = type === "project" ? "projects" : "cases";

  const {
    editorRef,
    initialContent,
    onChange: handleEditorChange,
  } = useDocumentEditor({
    id,
    loadContent: useCallback((id: string) => TaskStore.getContent(id, storeName), [storeName]),
    saveContent: useCallback(
      (id: string, md: string) => TaskStore.saveContent(id, md, storeName),
      [storeName],
    ),
  });

  // Load entity data
  useEffect(() => {
    EntityStore.get(storeName, id).then((data) => setEntity(data));
  }, [storeName, id]);

  // Reload entity on dataChanged (e.g. color update from another source)
  useEffect(() => {
    const handler = (detail: { entityType?: string }) => {
      const matchType = type === "project" ? "project" : "case";
      if (!detail || detail.entityType === matchType || detail.entityType === "all") {
        EntityStore.get(storeName, id).then((data) => {
          if (data) setEntity(data);
        });
      }
    };
    EntityStore.on("dataChanged", handler);
    return () => EntityStore.off("dataChanged", handler);
  }, [type, storeName, id]);

  const toggleView = useCallback(() => {
    editorRef.current?.flushSave();
    tasks.setViewMode(id, showingDoc ? "table" : "doc");
  }, [id, showingDoc, tasks, editorRef]);

  if (!entity || initialContent === null)
    return <div className={s["task-content-placeholder"]}>読み込み中...</div>;

  const toolbarLeftSlot =
    sidebarCollapsed && onExpandSidebar ? (
      <ToolbarSlot>
        <SidebarExpandButton onClick={onExpandSidebar} />
      </ToolbarSlot>
    ) : undefined;

  const toolbarRightSlot = (
    <ToolbarSlot>
      <button className={s["task-view-toggle"]} onClick={toggleView}>
        {showingDoc ? "タスク" : "ドキュメント"}
      </button>
    </ToolbarSlot>
  );

  const metaChildren = (
    <>
      <MetaTitle>
        <ContentHeaderName
          name={entity.name}
          onRename={(name) => {
            setEntity((prev: any) => ({ ...prev, name }));
            tasks.rename(type, id, name);
          }}
          suffix={
            type === "project" ? (
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
            ) : undefined
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

  return (
    <div className={s["task-detail"]}>
      {/* Doc view */}
      <div style={{ display: showingDoc ? "contents" : "none" }}>
        <DocumentEditor
          initialValue={initialContent}
          documentId={id}
          onChange={handleEditorChange}
          placeholder="ドキュメントを入力..."
          editorRef={editorRef}
          toolbarLeft={toolbarLeftSlot}
          toolbarRight={toolbarRightSlot}
          className={s["task-wiki-container"]}
        >
          {metaChildren}
        </DocumentEditor>
      </div>

      {/* Table view — reuse editor toolbar-row class for identical height/position */}
      {!showingDoc && (
        <div className={pageRootClass}>
          <div className="mdg-editor-toolbar-row">
            {toolbarLeftSlot}
            {/* spacer matching mdg-editor-header height (28px btn + 4px*2 pad) */}
            <div style={{ flex: 1, minHeight: 38 }} />
            {toolbarRightSlot}
          </div>
          <TaskTableView tasks={tasks} parentType={type} parentId={id} />
        </div>
      )}
    </div>
  );
}

// =========================================================
// Task Detail Content
// =========================================================

function TaskDetailContent({
  tasks,
  id,
  sidebarCollapsed,
  onExpandSidebar,
}: {
  tasks: UseTasksReturn;
  id: string;
  sidebarCollapsed?: boolean;
  onExpandSidebar?: () => void;
}) {
  const [entity, setEntity] = useState<any>(null);
  const [recordsOpen, setRecordsOpen] = useState(false);
  const [records, setRecords] = useState<any[] | null>(null);
  const [recordsLoading, setRecordsLoading] = useState(false);

  const {
    editorRef,
    initialContent,
    onChange: handleEditorChange,
  } = useDocumentEditor({
    id,
    loadContent: useCallback((id: string) => TaskStore.getContent(id, "tasks"), []),
    saveContent: useCallback(
      (id: string, md: string) => TaskStore.saveContent(id, md, "tasks"),
      [],
    ),
  });

  // Load entity data
  useEffect(() => {
    EntityStore.get("tasks", id).then((data) => setEntity(data));
  }, [id]);

  // Reset records state on id change
  useEffect(() => {
    setRecords(null);
    setRecordsOpen(false);
  }, [id]);

  // Reload entity on dataChanged
  useEffect(() => {
    const handler = (detail: { entityType?: string }) => {
      if (!detail || detail.entityType === "task" || detail.entityType === "all") {
        EntityStore.get("tasks", id).then((data) => {
          if (data) setEntity(data);
        });
      }
    };
    EntityStore.on("dataChanged", handler);
    return () => EntityStore.off("dataChanged", handler);
  }, [id]);

  // Load work records
  useEffect(() => {
    if (recordsOpen && records === null) {
      setRecordsLoading(true);
      serverCall("getTaskPomodoroRecords", id)
        .then((data) => setRecords((data as any[]) || []))
        .catch(() => setRecords([]))
        .finally(() => setRecordsLoading(false));
    }
  }, [recordsOpen, records, id]);

  if (!entity || initialContent === null)
    return <div className={s["task-content-placeholder"]}>読み込み中...</div>;

  const sc = STATUS_CONFIG[entity.status] || STATUS_CONFIG.todo;

  const toolbarLeftSlot =
    sidebarCollapsed && onExpandSidebar ? (
      <ToolbarSlot>
        <SidebarExpandButton onClick={onExpandSidebar} />
      </ToolbarSlot>
    ) : undefined;

  const metaChildren = (
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

  return (
    <div className={s["task-detail"]}>
      <DocumentEditor
        initialValue={initialContent}
        documentId={id}
        onChange={handleEditorChange}
        placeholder="ドキュメントを入力..."
        editorRef={editorRef}
        toolbarLeft={toolbarLeftSlot}
        className={s["task-wiki-container"]}
      >
        {metaChildren}
      </DocumentEditor>

      {/* Work records — fixed at bottom, outside scroll area */}
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
    </div>
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
