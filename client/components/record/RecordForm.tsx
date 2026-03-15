/**
 * RecordForm — Work record submission form
 * Notion-like layout: toolbar(sticky) → meta → editor in single scroll, FormActions fixed at bottom
 */
import { useState, useCallback, useRef, useEffect } from "react";
import { useApp } from "../../contexts/AppContext";
import { useNavigation } from "../../contexts/NavigationContext";
import type { ViewerState } from "../../contexts/NavigationContext";
import { RecordField } from "../shared/RecordField";
import { FormActions } from "../shared/FormActions";
import { ItemPicker } from "../shared/ItemPicker";
import { HierarchicalTaskPicker } from "../shared/HierarchicalTaskPicker";
import { EditorLayout } from "../shared/EditorLayout";
import { useMarkdownEditor } from "../../hooks/useMarkdownEditor";
import { useEditorConfig } from "../../hooks/useEditorConfig";
import { useFormDraft } from "../../hooks/useFormDraft";
import { STORAGE_KEYS } from "../../lib/localStorage";
import { blobUrlsToDrive, resolveDriveUrls } from "../../lib/imageCache";
import { serverCall } from "../../lib/serverCall";
import * as TaskStore from "../../lib/taskStore";
import * as RecordCache from "../../lib/recordCache";
import { SaveOverlay } from "../shared/SaveOverlay";
import s from "./RecordForm.module.css";

interface RecordDraft {
  startTimestamp: number;
  desc: string;
  category: string[];
  projectId: string | null;
  caseId: string | null;
  taskId: string | null;
}

export function RecordForm() {
  const { timer } = useApp();
  const nav = useNavigation();
  const editorConfig = useEditorConfig();
  const { state } = timer;

  const [charCount, setCharCount] = useState(0);

  // Draft persistence
  const { initialDraft, saveDraft, clearDraft } = useFormDraft<RecordDraft>(
    STORAGE_KEYS.RECORD_DRAFT,
  );
  const restoredDraft =
    initialDraft && initialDraft.startTimestamp === state.startTimestamp ? initialDraft : null;
  // Clear stale draft from a different pomodoro session
  if (initialDraft && !restoredDraft) clearDraft();

  const [selectedCategory, setSelectedCategory] = useState<string[]>(restoredDraft?.category ?? []);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    restoredDraft?.projectId ?? null,
  );
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(
    restoredDraft?.caseId ?? null,
  );
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(
    restoredDraft?.taskId ?? null,
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Refs for latest meta values (stable onChange callback)
  const metaRef = useRef({
    category: selectedCategory,
    projectId: selectedProjectId,
    caseId: selectedCaseId,
    taskId: selectedTaskId,
  });
  metaRef.current = {
    category: selectedCategory,
    projectId: selectedProjectId,
    caseId: selectedCaseId,
    taskId: selectedTaskId,
  };

  const {
    editor,
    mode,
    setMode,
    rawMarkdown,
    setRawMarkdown,
    getMarkdown,
    applyContent,
    resetContent,
  } = useMarkdownEditor({
    initialContent: restoredDraft?.desc ?? "",
    onChange: (md) => triggerSave(md),
    onCharCount: setCharCount,
    ...editorConfig.editorProps,
  });

  // Save draft helper (reads desc from editor + meta from ref)
  const getMarkdownRef = useRef(getMarkdown);
  getMarkdownRef.current = getMarkdown;
  const triggerSave = useCallback(
    (descOverride?: string) => {
      const desc = descOverride ?? getMarkdownRef.current();
      saveDraft({
        startTimestamp: state.startTimestamp!,
        desc,
        category: metaRef.current.category,
        projectId: metaRef.current.projectId,
        caseId: metaRef.current.caseId,
        taskId: metaRef.current.taskId,
      });
    },
    [saveDraft, state.startTimestamp],
  );

  // Re-save when meta fields change
  useEffect(() => {
    triggerSave();
  }, [selectedCategory, selectedProjectId, selectedCaseId, selectedTaskId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Hierarchy picker change handler
  const handleHierarchyChange = useCallback(
    (pId: string | null, cId: string | null, tId: string | null) => {
      setSelectedProjectId(pId);
      setSelectedCaseId(cId);
      setSelectedTaskId(tId);
    },
    [],
  );

  // Interruption list rendering
  const interruptions = state.interruptions;
  const totalIntSecs = interruptions.reduce((s, i) => s + i.durationSeconds, 0);
  const totalIntMins = Math.floor(totalIntSecs / 60);
  const totalIntRemSecs = totalIntSecs % 60;
  const totalIntStr =
    totalIntMins > 0
      ? `${totalIntMins}分${totalIntRemSecs > 0 ? `${totalIntRemSecs}秒` : ""}`
      : `${totalIntRemSecs}秒`;

  // Open interruption in viewer
  const openInterruptionInViewer = useCallback(
    (index: number) => {
      const int = state.interruptions[index];
      if (!int) return;

      const viewerState: ViewerState = {
        markdown: int.content || "",
        recordId: null,
        recordType: null,
        category: int.category || "",
        sheetType: "InterruptionCategories",
        interruptionType: int.type as "work" | "nonWork",
        startTime: int.startTime,
        endTime: int.endTime,
        onSaveMarkdown: (markdown) => {
          timer.state.interruptions[index].content = markdown;
        },
        onSaveCategory: (category) => {
          timer.state.interruptions[index].category = category;
        },
        onSaveType: (type) => {
          timer.state.interruptions[index].type = type;
        },
        onSaveTime: (startISO, endISO, durSecs) => {
          timer.state.interruptions[index].startTime = startISO;
          timer.state.interruptions[index].endTime = endISO;
          timer.state.interruptions[index].durationSeconds = durSecs;
        },
      };
      nav.showViewer(viewerState);
    },
    [state.interruptions, nav, timer],
  );

  // Copy from previous record
  const copyFromPrevious = useCallback(async () => {
    try {
      const result = (await serverCall("getLastWorkRecord")) as any;
      if (!result) return;
      if (result.content) {
        const resolved = await resolveDriveUrls(result.content);
        applyContent(resolved, { addToHistory: true });
      }
      if (result.category) {
        setSelectedCategory([result.category]);
      }
      if (result.projectId) setSelectedProjectId(result.projectId);
      if (result.caseId) setSelectedCaseId(result.caseId);
      if (result.taskId) setSelectedTaskId(result.taskId);
    } catch {
      // ignore
    }
  }, [applyContent]);

  // Submit record
  const submitAndDo = useCallback(
    async (action: "break" | "nextWork" | "endSession") => {
      if (state.phase !== "work") return;
      setIsSubmitting(true);

      try {
        const endTime = new Date();
        const content = blobUrlsToDrive(getMarkdown() || "").trim();
        const category = selectedCategory[0] || "";
        const startTime = new Date(state.startTimestamp!);
        const actualSeconds = Math.round((endTime.getTime() - startTime.getTime()) / 1000);
        const completionStatus =
          state.elapsedSeconds >= state.totalSeconds ? "completed" : "abandoned";

        const record = buildRecord(
          state,
          content,
          category,
          startTime,
          endTime,
          actualSeconds,
          completionStatus,
          selectedProjectId,
          selectedCaseId,
          selectedTaskId,
        );
        const intRecords = buildInterruptionRecords(state, record.id);

        // Ensure category exists
        if (category) {
          await ensureCategory(category, state.categories);
        }

        // Save to server in parallel
        await Promise.all([
          serverCall("saveRecord", record),
          intRecords.length > 0 ? serverCall("saveInterruptions", intRecords) : undefined,
        ]);

        // Write-through to IDB cache (single event emit)
        await RecordCache.upsertRecordWithInterruptions(record, intRecords);

        // Update task stats (delta-based)
        if (record.type === "work" && record.taskId) {
          await TaskStore.adjustTaskStats(record.taskId, record.actualDurationSeconds, 1);
        }

        // Clear draft before clearing form (prevents unmount flush re-saving)
        clearDraft();

        // Clear form
        resetContent("");
        setSelectedCategory([]);
        setSelectedProjectId(null);
        setSelectedCaseId(null);
        setSelectedTaskId(null);

        // Transition timer
        if (action === "break") {
          timer.onRecordSaved();
        } else if (action === "nextWork") {
          timer.startNextWork();
        } else {
          timer.endWorkSession();
        }
      } catch (err) {
        alert("記録の保存に失敗しました: " + err);
      } finally {
        setIsSubmitting(false);
      }
    },
    [
      state,
      selectedCategory,
      selectedProjectId,
      selectedCaseId,
      selectedTaskId,
      timer,
      clearDraft,
      getMarkdown,
      resetContent,
    ],
  );

  return (
    <div className={s["record-form"]}>
      <SaveOverlay visible={isSubmitting} />
      <EditorLayout
        editor={editor}
        mode={mode}
        setMode={setMode}
        rawMarkdown={rawMarkdown}
        setRawMarkdown={setRawMarkdown}
        charCount={charCount}
        maxCharCount={50000}
        placeholder="何に取り組みましたか？"
        onImageUpload={editorConfig.editorProps.onImageUpload}
      >
        <button className={s["copy-previous-btn"]} onClick={copyFromPrevious}>
          前回をコピー
        </button>
        <RecordField label="カテゴリ">
          <ItemPicker
            mode="single"
            items={state.categories}
            selected={selectedCategory}
            onSelect={setSelectedCategory}
            onColorChange={(name, color) => {
              serverCall("updateCategoryColor", name, color, "Categories");
            }}
            placeholder="カテゴリを検索 / 作成..."
          />
        </RecordField>

        <HierarchicalTaskPicker
          projectId={selectedProjectId}
          caseId={selectedCaseId}
          taskId={selectedTaskId}
          onChange={handleHierarchyChange}
        />
      </EditorLayout>

      {/* Interruption list */}
      {interruptions.length > 0 && (
        <div className={s["interruption-list"]}>
          <div className={s["interruption-summary"]}>
            中断 {interruptions.length}回 (計{totalIntStr})
          </div>
          <div className={s["interruption-compact-list"]}>
            {interruptions.map((int, idx) => {
              const typeLabel = int.type === "work" ? "作業" : "非作業";
              const mins = Math.floor(int.durationSeconds / 60);
              const secs = int.durationSeconds % 60;
              const durStr = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
              const title = int.content?.split("\n")[0]?.trim() || "";
              const parts = [typeLabel, durStr, int.category, title].filter(Boolean);
              const catColor = state.interruptionCategories.find(
                (c) => c.name === int.category,
              )?.color;

              return (
                <div
                  key={int.id}
                  className={s["interruption-compact-item"]}
                  style={catColor ? { borderLeftColor: catColor } : undefined}
                  onClick={() => openInterruptionInViewer(idx)}
                >
                  {parts.join(" · ")}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Action buttons — fixed at bottom */}
      <FormActions>
        <button
          className="btn btn-primary"
          onClick={() => submitAndDo("break")}
          disabled={isSubmitting || state.phase === "interrupted"}
        >
          休憩
        </button>
        <button
          className="btn btn-secondary"
          onClick={() => submitAndDo("nextWork")}
          disabled={isSubmitting || state.phase === "interrupted"}
        >
          次の作業
        </button>
        <button
          className="btn btn-danger"
          onClick={() => submitAndDo("endSession")}
          disabled={isSubmitting || state.phase === "interrupted"}
        >
          終了
        </button>
      </FormActions>
    </div>
  );
}

// =========================================================
// Helpers
// =========================================================

function formatDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function buildRecord(
  state: import("../../types/timer").TimerState,
  content: string,
  category: string,
  startTime: Date,
  endTime: Date,
  actualSeconds: number,
  completionStatus: string,
  projectId: string | null,
  caseId: string | null,
  taskId: string | null,
) {
  const workCount = state.interruptions.filter((i) => i.type === "work").length;
  const nonWorkCount = state.interruptions.filter((i) => i.type === "nonWork").length;
  const workIntSeconds = state.interruptions
    .filter((i) => i.type === "work")
    .reduce((sum, i) => sum + i.durationSeconds, 0);
  const nonWorkIntSeconds = state.interruptions
    .filter((i) => i.type === "nonWork")
    .reduce((sum, i) => sum + i.durationSeconds, 0);

  return {
    id: crypto.randomUUID(),
    date: formatDate(startTime),
    startTime: startTime.toISOString(),
    endTime: endTime.toISOString(),
    durationSeconds: state.config.workMinutes * 60,
    actualDurationSeconds: actualSeconds,
    type: "work",
    content,
    category,
    workInterruptions: workCount,
    nonWorkInterruptions: nonWorkCount,
    workInterruptionSeconds: workIntSeconds,
    nonWorkInterruptionSeconds: nonWorkIntSeconds,
    completionStatus,
    pomodoroSetIndex: state.pomodoroSetIndex,
    taskId: taskId || "",
    projectId: projectId || "",
    caseId: caseId || "",
  };
}

function buildInterruptionRecords(
  state: import("../../types/timer").TimerState,
  pomodoroId: string,
) {
  return state.interruptions.map((i) => ({
    id: i.id,
    pomodoroId,
    type: i.type,
    startTime: i.startTime,
    endTime: i.endTime,
    durationSeconds: i.durationSeconds,
    category: i.category || "",
    content: i.content || "",
  }));
}

async function ensureCategory(category: string, existing: { name: string }[]) {
  if (!category) return;
  if (existing.some((c) => c.name === category)) return;
  const result = (await serverCall("addCategory", category, "#757575")) as any;
  if (result?.success) {
    await serverCall("getCategories");
  }
}
