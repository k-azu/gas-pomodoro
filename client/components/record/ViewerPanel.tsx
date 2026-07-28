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
import { EditorLayout } from "../shared/EditorLayout";
import { useMarkdownEditor } from "../../hooks/useMarkdownEditor";
import { useEditorConfig } from "../../hooks/useEditorConfig";
import { blobUrlsToDrive, resolveDriveUrls } from "../../lib/imageCache";
import { serverCall } from "../../lib/serverCall";
import * as TaskStore from "../../lib/taskStore";
import * as RecordCache from "../../lib/recordCache";
import {
  getViewerIdentity,
  loadViewerDraft,
  removeViewerDraft,
  saveActiveViewerSnapshot,
  saveViewerDraft,
} from "../../lib/viewerDraft";
import type { ViewerDraft } from "../../lib/viewerDraft";
import { SaveOverlay } from "../shared/SaveOverlay";
import s from "./ViewerPanel.module.css";

export function ViewerPanel() {
  const nav = useNavigation();
  const vs = nav.viewerState;

  if (!vs) return null;

  return <ViewerContent key={getViewerIdentity(vs) ?? "mem"} viewerState={vs} />;
}

function ViewerContent({ viewerState: vs }: { viewerState: ViewerState }) {
  const { timer } = useApp();
  const { closeViewer, navigateToDocument, setViewerSaving, registerViewerExitGuard } =
    useNavigation();
  const editorConfig = useEditorConfig();
  const identity = getViewerIdentity(vs);
  const activeSourceRef = useRef(vs);
  const initialDraftRef = useRef(identity ? loadViewerDraft(identity) : null);
  const initialDraft = initialDraftRef.current;

  const [charCount, setCharCount] = useState(0);
  const [resolvedMarkdown, setResolvedMarkdown] = useState<string | null>(null);
  const [currentMarkdown, setCurrentMarkdown] = useState(
    initialDraft?.fields.markdown ?? vs.markdown ?? "",
  );
  const [selectedCategory, setSelectedCategory] = useState<string[]>(
    initialDraft
      ? initialDraft.fields.category
        ? [initialDraft.fields.category]
        : []
      : vs.category
        ? [vs.category]
        : [],
  );
  const [intType, setIntType] = useState<boolean>(
    (initialDraft?.fields.interruptionType ?? vs.interruptionType) === "work",
  );
  const [startTime, setStartTime] = useState(
    () => initialDraft?.fields.startTime ?? toDatetimeLocal(vs.startTime),
  );
  const [endTime, setEndTime] = useState(
    () => initialDraft?.fields.endTime ?? toDatetimeLocal(vs.endTime),
  );
  const [isSaving, setIsSaving] = useState(false);
  const [pendingExit, setPendingExit] = useState<{
    intent: "close" | "replace";
    proceed: () => void;
  } | null>(null);
  const [restoredDraftVisible, setRestoredDraftVisible] = useState(!!initialDraft);
  const draftClearedRef = useRef(false);

  // Task hierarchy state (work records only)
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    initialDraft?.fields.projectId ?? vs.projectId ?? null,
  );
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(
    initialDraft?.fields.caseId ?? vs.caseId ?? null,
  );
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(
    initialDraft?.fields.taskId ?? vs.taskId ?? null,
  );
  const showTaskPicker = vs.recordType === "record" || vs.onSaveHierarchy !== undefined;

  // Auto-fill project/case from taskId for legacy records (only when record has no projectId)
  useEffect(() => {
    if (initialDraft || !showTaskPicker || vs.projectId || !vs.taskId) return;
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
  }, [initialDraft, showTaskPicker, vs.projectId, vs.taskId]);

  const handleHierarchyChange = useCallback(
    (pId: string | null, cId: string | null, tId: string | null) => {
      setSelectedProjectId(pId);
      setSelectedCaseId(cId);
      setSelectedTaskId(tId);
    },
    [],
  );

  const openSelectedTask = useCallback(
    (taskId: string) => {
      navigateToDocument("task", { taskNode: { type: "task", id: taskId } });
    },
    [navigateToDocument],
  );

  const { editor, mode, setMode, rawMarkdown, setRawMarkdown, getMarkdown, applyContent } =
    useMarkdownEditor({
      initialContent: "",
      onChange: (md) => {
        draftClearedRef.current = false;
        setCurrentMarkdown(md);
        setMarkdownDirty(md !== origMarkdown.current);
      },
      onCharCount: setCharCount,
      ...editorConfig.editorProps,
    });

  // Resolve Drive URLs in initial markdown
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      resolveDriveUrls(vs.markdown || ""),
      initialDraft
        ? resolveDriveUrls(initialDraft.fields.markdown || "")
        : Promise.resolve<string | null>(null),
    ]).then(([original, restored]) => {
      if (cancelled) return;
      const displayed = restored ?? original;
      origMarkdown.current = original;
      setCurrentMarkdown(displayed);
      setMarkdownDirty(displayed !== original);
      setResolvedMarkdown(displayed);
    });
    return () => {
      cancelled = true;
    };
  }, [vs.markdown, initialDraft]);

  // Apply resolved content after EditorLayout mounts (view must be available)
  useEffect(() => {
    if (resolvedMarkdown === null) return;
    applyContent(resolvedMarkdown, { addToHistory: false });
  }, [resolvedMarkdown, applyContent]);

  // Track original values for change detection
  const origCategory = useRef(vs.category);
  const origType = useRef(vs.interruptionType);
  const origStartTime = useRef(toDatetimeLocal(vs.startTime));
  const origEndTime = useRef(toDatetimeLocal(vs.endTime));
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

  const handleSave = useCallback(async (): Promise<boolean> => {
    const editorMarkdown = getMarkdown() || "";
    const markdown = blobUrlsToDrive(editorMarkdown);
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
      origMarkdown.current = editorMarkdown;
      activeSourceRef.current = buildSavedViewerState(
        vs,
        markdown,
        newCategory,
        newType,
        startTime,
        endTime,
        newProjectId,
        newCaseId,
        newTaskId,
      );
      setCurrentMarkdown(editorMarkdown);
      setMarkdownDirty(false);
      if (identity) removeViewerDraft(identity);
      draftClearedRef.current = true;
      setRestoredDraftVisible(false);
      return true;
    }

    // Server save
    if (!vs.recordId) return false;
    setIsSaving(true);
    setViewerSaving(true);

    try {
      const fn =
        vs.recordType === "interruption" ? "updateInterruptionDetails" : "updateRecordDetails";
      const result = (await serverCall(fn, vs.recordId, {
        content: markdown,
        category: newCategory,
        interruptionType: newType,
        startTime: startTime ? new Date(startTime).toISOString() : null,
        endTime: endTime ? new Date(endTime).toISOString() : null,
        projectId: newProjectId,
        caseId: newCaseId,
        taskId: newTaskId,
      })) as any;
      if (!result?.success) throw new Error("更新対象の履歴が見つかりませんでした");

      // Write-through the single final server snapshot to IDB.
      if (result.record) await RecordCache.upsertRecord(result.record);
      if (result.interruption) await RecordCache.upsertInterruptions([result.interruption]);

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
      origMarkdown.current = editorMarkdown;
      activeSourceRef.current = buildSavedViewerState(
        vs,
        markdown,
        newCategory,
        newType,
        startTime,
        endTime,
        newProjectId,
        newCaseId,
        newTaskId,
      );
      setCurrentMarkdown(editorMarkdown);
      setMarkdownDirty(false);
      if (identity) removeViewerDraft(identity);
      draftClearedRef.current = true;
      setRestoredDraftVisible(false);
      return true;
    } catch (err) {
      alert("保存に失敗しました: " + err);
      return false;
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
    getMarkdown,
    identity,
  ]);

  const draft: ViewerDraft | null =
    identity && resolvedMarkdown !== null
      ? {
          identity,
          source: activeSourceRef.current,
          fields: {
            markdown: blobUrlsToDrive(currentMarkdown),
            category: selectedCategory[0] || "",
            interruptionType: vs.interruptionType ? (intType ? "work" : "nonWork") : null,
            startTime,
            endTime,
            projectId: selectedProjectId,
            caseId: selectedCaseId,
            taskId: selectedTaskId,
          },
          dirty: isDirty,
          updatedAt: new Date().toISOString(),
        }
      : null;
  const latestDraftRef = useRef<ViewerDraft | null>(draft);
  latestDraftRef.current = draft;
  const isDirtyRef = useRef(isDirty);
  isDirtyRef.current = isDirty;
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Persist an unsaved viewer draft without committing it to the server.
  useEffect(() => {
    if (!identity || !draft || resolvedMarkdown === null) return;
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    if (!isDirty) {
      removeViewerDraft(identity);
      saveActiveViewerSnapshot(draft);
      return;
    }
    draftClearedRef.current = false;
    draftTimerRef.current = setTimeout(() => {
      draftTimerRef.current = null;
      const latest = latestDraftRef.current;
      if (latest) saveViewerDraft(latest);
    }, 1000);
    return () => {
      if (draftTimerRef.current) {
        clearTimeout(draftTimerRef.current);
        draftTimerRef.current = null;
      }
    };
  }, [identity, draft, isDirty, resolvedMarkdown]);

  // A reload cannot await google.script.run. Flush synchronously and warn only if recovery failed.
  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!isDirtyRef.current) return;
      const latest = latestDraftRef.current;
      if (latest && saveViewerDraft(latest)) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);

  // Route destructive viewer transitions through the same three-way decision.
  useEffect(() => {
    registerViewerExitGuard((intent, proceed) => {
      if (isSaving) return;
      if (!isDirty) {
        proceed();
        return;
      }
      const latest = latestDraftRef.current;
      if (latest) saveViewerDraft(latest);
      setPendingExit({ intent, proceed });
    });
    return () => registerViewerExitGuard(null);
  }, [isDirty, isSaving, registerViewerExitGuard]);

  // Flush a pending draft on unmount; successful save/discard already removed it.
  useEffect(
    () => () => {
      setViewerSaving(false);
      if (!draftClearedRef.current && isDirtyRef.current && latestDraftRef.current) {
        saveViewerDraft(latestDraftRef.current);
      }
    },
    [setViewerSaving],
  );

  const discardAndProceed = useCallback(() => {
    if (identity) removeViewerDraft(identity);
    draftClearedRef.current = true;
    const proceed = pendingExit?.proceed;
    setPendingExit(null);
    proceed?.();
  }, [identity, pendingExit]);

  const saveAndProceed = useCallback(async () => {
    const saved = await handleSave();
    if (!saved) return;
    const proceed = pendingExit?.proceed;
    setPendingExit(null);
    proceed?.();
  }, [handleSave, pendingExit]);

  if (resolvedMarkdown === null) return null;

  return (
    <div className={s["viewer-panel"]}>
      <SaveOverlay visible={isSaving} />
      {restoredDraftVisible && (
        <div className={s["draft-notice"]} role="status">
          未保存の変更を復元しました
        </div>
      )}
      <EditorLayout
        editor={editor}
        mode={mode}
        setMode={setMode}
        rawMarkdown={rawMarkdown}
        setRawMarkdown={setRawMarkdown}
        charCount={charCount}
        maxCharCount={50000}
        placeholder=""
        onImageUpload={editorConfig.editorProps.onImageUpload}
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
            onOpenTask={openSelectedTask}
          />
        )}
      </EditorLayout>

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
      {pendingExit && (
        <div className={s["exit-backdrop"]} role="presentation">
          <section
            className={s["exit-dialog"]}
            role="dialog"
            aria-modal="true"
            aria-label="未保存の変更"
          >
            <h2>未保存の変更があります</h2>
            <p>
              {pendingExit.intent === "replace"
                ? "変更を保存して、選択した履歴を開きますか？"
                : "変更を保存して履歴詳細を閉じますか？"}
            </p>
            <div className={s["exit-actions"]}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={saveAndProceed}
                disabled={isSaving}
              >
                保存して移動
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={discardAndProceed}
                disabled={isSaving}
              >
                変更を破棄
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setPendingExit(null)}
                disabled={isSaving}
              >
                編集を続ける
              </button>
            </div>
          </section>
        </div>
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

function buildSavedViewerState(
  source: ViewerState,
  markdown: string,
  category: string,
  interruptionType: "work" | "nonWork",
  startTime: string,
  endTime: string,
  projectId: string,
  caseId: string,
  taskId: string,
): ViewerState {
  const start = startTime ? new Date(startTime) : null;
  const end = endTime ? new Date(endTime) : null;
  const hasValidTimes =
    start !== null &&
    end !== null &&
    Number.isFinite(start.getTime()) &&
    Number.isFinite(end.getTime());
  return {
    ...source,
    markdown,
    category,
    interruptionType: source.interruptionType ? interruptionType : null,
    startTime: start?.toISOString() ?? source.startTime,
    endTime: end?.toISOString() ?? source.endTime,
    projectId,
    caseId,
    taskId,
    actualDurationSeconds: hasValidTimes
      ? Math.max(0, Math.round((end.getTime() - start.getTime()) / 1000))
      : source.actualDurationSeconds,
  };
}
