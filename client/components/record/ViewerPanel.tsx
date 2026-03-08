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
import { HierarchicalTaskPicker } from "../shared/HierarchicalTaskPicker";
import { DocumentEditor } from "../shared/DocumentEditor";
import type { MarkdownEditorRef } from "../shared/DocumentEditor";
import { useEditorConfig } from "../../hooks/useEditorConfig";
import { blobUrlsToDrive, resolveDriveUrls } from "../../lib/imageCache";
import { serverCall } from "../../lib/serverCall";
import * as TaskStore from "../../lib/taskStore";
import * as RecordCache from "../../lib/recordCache";
import { SaveOverlay } from "../shared/SaveOverlay";
import s from "./ViewerPanel.module.css";

export function ViewerPanel() {
  const nav = useNavigation();
  const vs = nav.viewerState;

  if (!vs) return null;

  return <ViewerContent key={vs.recordId ?? "mem"} viewerState={vs} />;
}

function ViewerContent({ viewerState: vs }: { viewerState: ViewerState }) {
  const { timer } = useApp();
  const { closeViewer, setViewerSaving } = useNavigation();
  const editorConfig = useEditorConfig();

  const editorRef = useRef<MarkdownEditorRef | null>(null);
  const [resolvedMarkdown, setResolvedMarkdown] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string[]>(
    vs.category ? [vs.category] : [],
  );
  const [intType, setIntType] = useState<boolean>(vs.interruptionType === "work");
  const [startTime, setStartTime] = useState(() => toDatetimeLocal(vs.startTime));
  const [endTime, setEndTime] = useState(() => toDatetimeLocal(vs.endTime));
  const [isSaving, setIsSaving] = useState(false);

  // Task hierarchy state (work records only)
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(vs.projectId || null);
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(vs.caseId || null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(vs.taskId || null);
  const showTaskPicker = vs.recordType === "record" || vs.onSaveHierarchy !== undefined;

  // Auto-fill project/case from taskId for legacy records (only when record has no projectId)
  useEffect(() => {
    if (!showTaskPicker || vs.projectId || !vs.taskId) return;
    (async () => {
      try {
        const tasks = await TaskStore.getAllTasks();
        const t = (tasks as any[]).find((t) => t.id === vs.taskId);
        if (t) {
          if (t.projectId) setSelectedProjectId(t.projectId);
          if (t.caseId) setSelectedCaseId(t.caseId);
        }
      } catch {
        // ignore
      }
    })();
  }, [showTaskPicker, vs.projectId, vs.taskId]);

  const handleHierarchyChange = useCallback(
    (pId: string | null, cId: string | null, tId: string | null) => {
      setSelectedProjectId(pId);
      setSelectedCaseId(cId);
      setSelectedTaskId(tId);
    },
    [],
  );

  // Resolve Drive URLs in initial markdown + set origMarkdown before editor mounts
  useEffect(() => {
    if (vs.markdown) {
      resolveDriveUrls(vs.markdown).then((md) => {
        origMarkdown.current = md;
        setResolvedMarkdown(md);
      });
    } else {
      origMarkdown.current = vs.markdown ?? "";
      setResolvedMarkdown(vs.markdown);
    }
  }, [vs.markdown]);

  // Track original values for change detection
  const origCategory = useRef(vs.category);
  const origType = useRef(vs.interruptionType);
  const origStartTime = useRef(startTime);
  const origEndTime = useRef(endTime);
  const origProjectId = useRef(vs.projectId || null);
  const origCaseId = useRef(vs.caseId || null);
  const origTaskId = useRef(vs.taskId || null);
  const origActualDuration = useRef(vs.actualDurationSeconds ?? 0);
  const origMarkdown = useRef<string | null>(null);
  const [markdownDirty, setMarkdownDirty] = useState(false);

  const categories =
    vs.sheetType === "InterruptionCategories"
      ? timer.state.interruptionCategories
      : timer.state.categories;

  const canSave = !!(vs.recordId || vs.onSaveMarkdown);

  const isDirty =
    markdownDirty ||
    (selectedCategory[0] || "") !== (origCategory.current || "") ||
    (vs.interruptionType ? (intType ? "work" : "nonWork") !== origType.current : false) ||
    startTime !== origStartTime.current ||
    endTime !== origEndTime.current ||
    (showTaskPicker
      ? (selectedProjectId || "") !== (origProjectId.current || "") ||
        (selectedCaseId || "") !== (origCaseId.current || "") ||
        (selectedTaskId || "") !== (origTaskId.current || "")
      : false);

  const handleSave = useCallback(async () => {
    const markdown = blobUrlsToDrive(editorRef.current?.getValue() || "");
    const newCategory = selectedCategory[0] || "";
    const newType = intType ? "work" : "nonWork";
    const newProjectId = selectedProjectId || "";
    const newCaseId = selectedCaseId || "";
    const newTaskId = selectedTaskId || "";
    const categoryChanged = vs.sheetType && newCategory !== origCategory.current;
    const typeChanged = vs.interruptionType && newType !== origType.current;
    const startChanged = startTime !== origStartTime.current;
    const endChanged = endTime !== origEndTime.current;
    const hierarchyChanged =
      showTaskPicker &&
      (newProjectId !== (origProjectId.current || "") ||
        newCaseId !== (origCaseId.current || "") ||
        newTaskId !== (origTaskId.current || ""));

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
      if (vs.onSaveHierarchy && hierarchyChanged) {
        vs.onSaveHierarchy(newProjectId, newCaseId, newTaskId);
      }
      origCategory.current = newCategory;
      origType.current = newType as "work" | "nonWork";
      origStartTime.current = startTime;
      origEndTime.current = endTime;
      origProjectId.current = newProjectId;
      origCaseId.current = newCaseId;
      origTaskId.current = newTaskId;
      origMarkdown.current = markdown;
      setMarkdownDirty(false);
      return;
    }

    // Server save
    if (!vs.recordId) return;
    setIsSaving(true);
    setViewerSaving(true);

    try {
      const fn =
        vs.recordType === "interruption" ? "updateInterruptionContent" : "updateRecordContent";

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

      if (hierarchyChanged) {
        promises.push(
          serverCall("updateRecordHierarchy", vs.recordId, newProjectId, newCaseId, newTaskId),
        );
      }

      const results = await Promise.all(promises);

      // Write-through: update IDB cache from server responses
      for (const result of results) {
        const r = result as any;
        if (r?.record) await RecordCache.upsertRecord(r.record);
        if (r?.interruption) await RecordCache.upsertInterruptions([r.interruption]);
      }

      // Update task stats (work records only)
      if (vs.recordType === "record") {
        const oldTid = origTaskId.current || "";
        const newTid = newTaskId;
        const oldDur = origActualDuration.current;
        // Compute new duration: if time changed, recalculate from inputs; otherwise keep old
        let newDur = oldDur;
        if ((startChanged || endChanged) && startTime && endTime) {
          const ns = new Date(startTime);
          const ne = new Date(endTime);
          newDur = Math.max(0, Math.round((ne.getTime() - ns.getTime()) / 1000));
        }

        if (oldTid === newTid) {
          // Same task: time delta only
          if (oldDur !== newDur && newTid) {
            await TaskStore.adjustTaskStats(newTid, newDur - oldDur, 0);
          }
        } else {
          // Task moved
          if (oldTid) await TaskStore.adjustTaskStats(oldTid, -oldDur, -1);
          if (newTid) await TaskStore.adjustTaskStats(newTid, newDur, 1);
        }
        origActualDuration.current = newDur;
      }

      origCategory.current = newCategory;
      origType.current = newType as "work" | "nonWork";
      origStartTime.current = startTime;
      origEndTime.current = endTime;
      origProjectId.current = newProjectId;
      origCaseId.current = newCaseId;
      origTaskId.current = newTaskId;
      origMarkdown.current = markdown;
      setMarkdownDirty(false);
    } catch (err) {
      alert("保存に失敗しました: " + err);
    } finally {
      setIsSaving(false);
      setViewerSaving(false);
    }
  }, [
    vs,
    selectedCategory,
    intType,
    startTime,
    endTime,
    selectedProjectId,
    selectedCaseId,
    selectedTaskId,
    showTaskPicker,
    setViewerSaving,
  ]);

  // Clean up viewer-saving flag on unmount
  useEffect(() => () => setViewerSaving(false), [setViewerSaving]);

  if (resolvedMarkdown === null) return null;

  return (
    <div className={s["viewer-panel"]}>
      <SaveOverlay visible={isSaving} />
      <DocumentEditor
        {...editorConfig.editorProps}
        initialValue={resolvedMarkdown}
        onChange={(md) => setMarkdownDirty(md !== origMarkdown.current)}
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
        {showTaskPicker && (
          <HierarchicalTaskPicker
            projectId={selectedProjectId}
            caseId={selectedCaseId}
            taskId={selectedTaskId}
            onChange={handleHierarchyChange}
          />
        )}
      </DocumentEditor>

      {canSave && (
        <FormActions>
          <button className="btn btn-secondary" onClick={closeViewer}>
            戻る
          </button>
          <button className="btn btn-primary" onClick={handleSave} disabled={isSaving || !isDirty}>
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
