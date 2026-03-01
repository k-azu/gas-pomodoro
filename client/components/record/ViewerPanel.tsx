/**
 * ViewerPanel — Edit saved records/interruptions or in-memory interruption data
 * Notion-like layout: toolbar(sticky) → meta → editor in single scroll
 */
import { useState, useRef, useCallback, useEffect } from "react";
import { useApp } from "../../contexts/AppContext";
import { useNavigation } from "../../contexts/NavigationContext";
import type { ViewerState } from "../../contexts/NavigationContext";
import { TypeToggle, TimeInputGroup } from "../shared/PanelToolbar";
import { RecordField } from "../shared/RecordField";
import { FormActions } from "../shared/FormActions";
import { ItemPicker } from "../shared/ItemPicker";
import { DocumentEditor } from "../shared/DocumentEditor";
import type { MarkdownEditorRef } from "../shared/MarkdownEditorWrapper";
import { serverCall } from "../../lib/serverCall";
import * as TaskStore from "../../lib/taskStore";
import { STATUS_CONFIG } from "../../hooks/useTasks";
import s from "./ViewerPanel.module.css";

export function ViewerPanel() {
  const nav = useNavigation();
  const vs = nav.viewerState;

  if (!vs) return null;

  return <ViewerContent key={vs.recordId ?? "mem"} viewerState={vs} />;
}

function ViewerContent({ viewerState: vs }: { viewerState: ViewerState }) {
  const { timer, refreshAll } = useApp();
  const { closeViewer } = useNavigation();

  const editorRef = useRef<MarkdownEditorRef | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string[]>(
    vs.category ? [vs.category] : [],
  );
  const [intType, setIntType] = useState<boolean>(vs.interruptionType === "work");
  const [startTime, setStartTime] = useState(() => toDatetimeLocal(vs.startTime));
  const [endTime, setEndTime] = useState(() => toDatetimeLocal(vs.endTime));
  const [isSaving, setIsSaving] = useState(false);

  // Task picker state (work records only)
  const [taskItems, setTaskItems] = useState<{ name: string; color: string }[]>([]);
  const [taskIdMap, setTaskIdMap] = useState<Record<string, string>>({});
  const [selectedTaskLabel, setSelectedTaskLabel] = useState<string[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(vs.taskId || null);
  const showTaskPicker = vs.recordType === "record" || vs.onSaveTaskId !== undefined;

  // Load task items for picker
  useEffect(() => {
    if (!showTaskPicker) return;
    (async () => {
      try {
        const [tasks, projects, cases] = await Promise.all([
          TaskStore.getAllTasks(),
          TaskStore.getAllProjects(),
          TaskStore.getAllCases(),
        ]);

        const projMap: Record<string, string> = {};
        (projects as any[]).forEach((p) => {
          projMap[p.id] = p.name;
        });
        const caseMap: Record<string, any> = {};
        (cases as any[]).forEach((c) => {
          caseMap[c.id] = c;
        });

        const idMap: Record<string, string> = {};
        const items: { name: string; color: string }[] = [];
        (tasks as any[]).forEach((t) => {
          if (t.status === "done" || t.status === "docs") return;
          let path = projMap[t.projectId] || "";
          if (t.caseId && caseMap[t.caseId]) {
            path += " > " + caseMap[t.caseId].name;
          }
          const label = t.name + (path ? ` (${path})` : "");
          const statusColor = (STATUS_CONFIG[t.status] || { color: "#9e9e9e" }).color;
          idMap[label] = t.id;
          items.push({ name: label, color: statusColor });
        });

        setTaskItems(items);
        setTaskIdMap(idMap);

        // Restore selection from initial taskId
        if (vs.taskId) {
          const label = Object.entries(idMap).find(([, id]) => id === vs.taskId)?.[0];
          if (label) setSelectedTaskLabel([label]);
        }
      } catch {
        // TaskStore not ready yet
      }
    })();
  }, [showTaskPicker, vs.taskId]);

  // Track original values for change detection
  const origCategory = useRef(vs.category);
  const origType = useRef(vs.interruptionType);
  const origStartTime = useRef(startTime);
  const origEndTime = useRef(endTime);
  const origTaskId = useRef(vs.taskId || null);

  const categories =
    vs.sheetType === "InterruptionCategories"
      ? timer.state.interruptionCategories
      : timer.state.categories;

  const canSave = !!(vs.recordId || vs.onSaveMarkdown);

  const handleSave = useCallback(async () => {
    const markdown = editorRef.current?.getValue() || "";
    const newCategory = selectedCategory[0] || "";
    const newType = intType ? "work" : "nonWork";
    const newTaskId = selectedTaskId || "";
    const categoryChanged = vs.sheetType && newCategory !== origCategory.current;
    const typeChanged = vs.interruptionType && newType !== origType.current;
    const startChanged = startTime !== origStartTime.current;
    const endChanged = endTime !== origEndTime.current;
    const taskChanged = showTaskPicker && newTaskId !== (origTaskId.current || "");

    // In-memory save (editing unsaved interruption)
    if (vs.onSaveMarkdown) {
      vs.onSaveMarkdown(markdown);
      if (vs.onSaveCategory && categoryChanged) {
        vs.onSaveCategory(newCategory);
      }
      if (vs.onSaveType && typeChanged) {
        vs.onSaveType(newType as "work" | "nonWork");
      }
      if (vs.onSaveTime && (startChanged || endChanged) && startTime && endTime) {
        const ns = new Date(startTime);
        const ne = new Date(endTime);
        const durSecs = Math.max(0, Math.round((ne.getTime() - ns.getTime()) / 1000));
        vs.onSaveTime(ns.toISOString(), ne.toISOString(), durSecs);
      }
      if (vs.onSaveTaskId && taskChanged) {
        vs.onSaveTaskId(newTaskId);
      }
      origCategory.current = newCategory;
      origType.current = newType as "work" | "nonWork";
      origStartTime.current = startTime;
      origEndTime.current = endTime;
      origTaskId.current = newTaskId;
      return;
    }

    // Server save
    if (!vs.recordId) return;
    setIsSaving(true);

    try {
      const fn =
        vs.recordType === "interruption" ? "updateInterruptionNote" : "updateRecordDescription";

      const promises: Promise<unknown>[] = [serverCall(fn, vs.recordId, markdown)];

      if (categoryChanged) {
        const catFn =
          vs.recordType === "interruption" ? "updateInterruptionCategory" : "updateRecordCategory";
        promises.push(serverCall(catFn, vs.recordId, newCategory));
      }

      if (typeChanged) {
        promises.push(serverCall("updateInterruptionType", vs.recordId, newType));
      }

      if ((startChanged || endChanged) && startTime && endTime) {
        const ns = new Date(startTime);
        const ne = new Date(endTime);
        const timeFn =
          vs.recordType === "interruption" ? "updateInterruptionTimes" : "updateRecordTimes";
        promises.push(serverCall(timeFn, vs.recordId, ns.toISOString(), ne.toISOString()));
      }

      if (taskChanged) {
        promises.push(serverCall("updateRecordTaskId", vs.recordId, newTaskId));
      }

      await Promise.all(promises);
      origCategory.current = newCategory;
      origType.current = newType as "work" | "nonWork";
      origStartTime.current = startTime;
      origEndTime.current = endTime;
      origTaskId.current = newTaskId;
      refreshAll();
    } catch (err) {
      alert("保存に失敗しました: " + err);
    } finally {
      setIsSaving(false);
    }
  }, [
    vs,
    selectedCategory,
    intType,
    startTime,
    endTime,
    selectedTaskId,
    showTaskPicker,
    refreshAll,
  ]);

  return (
    <div className={s["viewer-panel"]}>
      <DocumentEditor
        initialValue={vs.markdown}
        onChange={() => {}}
        placeholder=""
        editorRef={editorRef}
      >
        {vs.startTime && vs.endTime && (
          <RecordField label="時間">
            <TimeInputGroup
              startTime={startTime}
              endTime={endTime}
              onStartChange={setStartTime}
              onEndChange={setEndTime}
            />
          </RecordField>
        )}
        {vs.interruptionType && (
          <RecordField label="作業に含める">
            <TypeToggle checked={intType} onChange={setIntType} label="" />
          </RecordField>
        )}
        {vs.sheetType && (
          <RecordField label="カテゴリ">
            <ItemPicker
              mode="single"
              items={categories}
              selected={selectedCategory}
              onSelect={setSelectedCategory}
              onColorChange={(name, color) => {
                if (vs.sheetType) {
                  serverCall("updateCategoryColor", name, color, vs.sheetType);
                }
              }}
              placeholder="カテゴリを検索 / 作成..."
            />
          </RecordField>
        )}
        {showTaskPicker && taskItems.length > 0 && (
          <RecordField label="タスク">
            <ItemPicker
              mode="single"
              items={taskItems}
              selected={selectedTaskLabel}
              onSelect={(selected) => {
                setSelectedTaskLabel(selected);
                setSelectedTaskId(selected.length > 0 ? taskIdMap[selected[0]] || null : null);
              }}
              placeholder="タスクを検索..."
            />
          </RecordField>
        )}
      </DocumentEditor>

      {canSave && (
        <FormActions>
          <button className="btn btn-secondary" onClick={closeViewer}>
            戻る
          </button>
          <button className="btn btn-primary" onClick={handleSave} disabled={isSaving}>
            保存
          </button>
        </FormActions>
      )}
    </div>
  );
}

/** Convert ISO string to datetime-local input value (YYYY-MM-DDTHH:MM) */
function toDatetimeLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
