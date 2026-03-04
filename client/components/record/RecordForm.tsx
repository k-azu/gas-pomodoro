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
import { DocumentEditor } from "../shared/DocumentEditor";
import type { MarkdownEditorRef } from "../shared/MarkdownEditorWrapper";
import { useEditorConfig } from "../../hooks/useEditorConfig";
import { useFormDraft } from "../../hooks/useFormDraft";
import { STORAGE_KEYS } from "../../lib/localStorage";
import { blobUrlsToDrive, resolveDriveUrls } from "../../lib/imageCache";
import { serverCall } from "../../lib/serverCall";
import * as TaskStore from "../../lib/taskStore";
import { STATUS_CONFIG } from "../../hooks/useTasks";
import s from "./RecordForm.module.css";

interface RecordDraft {
  startTimestamp: number;
  desc: string;
  category: string[];
  taskId: string | null;
  taskLabel: string[];
}

export function RecordForm() {
  const { timer, refreshAll } = useApp();
  const nav = useNavigation();
  const editorConfig = useEditorConfig();
  const { state } = timer;

  const editorRef = useRef<MarkdownEditorRef | null>(null);

  // Draft persistence
  const { initialDraft, saveDraft, clearDraft } = useFormDraft<RecordDraft>(
    STORAGE_KEYS.RECORD_DRAFT,
  );
  const restoredDraft =
    initialDraft && initialDraft.startTimestamp === state.startTimestamp ? initialDraft : null;
  // Clear stale draft from a different pomodoro session
  if (initialDraft && !restoredDraft) clearDraft();

  const [selectedCategory, setSelectedCategory] = useState<string[]>(restoredDraft?.category ?? []);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(
    restoredDraft?.taskId ?? null,
  );
  const [taskItems, setTaskItems] = useState<{ name: string; color: string }[]>([]);
  const [taskIdMap, setTaskIdMap] = useState<Record<string, string>>({});
  const [selectedTaskLabel, setSelectedTaskLabel] = useState<string[]>(
    restoredDraft?.taskLabel ?? [],
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Refs for latest meta values (stable onChange callback)
  const metaRef = useRef({
    category: selectedCategory,
    taskId: selectedTaskId,
    taskLabel: selectedTaskLabel,
  });
  metaRef.current = {
    category: selectedCategory,
    taskId: selectedTaskId,
    taskLabel: selectedTaskLabel,
  };

  // Save draft helper (reads desc from editor + meta from ref)
  const triggerSave = useCallback(
    (descOverride?: string) => {
      const desc = descOverride ?? editorRef.current?.getValue() ?? "";
      saveDraft({
        startTimestamp: state.startTimestamp!,
        desc,
        category: metaRef.current.category,
        taskId: metaRef.current.taskId,
        taskLabel: metaRef.current.taskLabel,
      });
    },
    [saveDraft, state.startTimestamp],
  );

  // Re-save when meta fields change
  useEffect(() => {
    triggerSave();
  }, [selectedCategory, selectedTaskId, selectedTaskLabel]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load task items for picker
  useEffect(() => {
    refreshTaskItems();
  }, []);

  const refreshTaskItems = useCallback(async () => {
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

      // Restore selection
      if (selectedTaskId) {
        const label = Object.entries(idMap).find(([, id]) => id === selectedTaskId)?.[0];
        if (label) setSelectedTaskLabel([label]);
      }
    } catch {
      // TaskStore not ready yet
    }
  }, [selectedTaskId]);

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
        markdown: int.note || "",
        recordId: null,
        recordType: null,
        category: int.category || "",
        sheetType: "InterruptionCategories",
        interruptionType: int.type as "work" | "nonWork",
        startTime: int.startTime,
        endTime: int.endTime,
        onSaveMarkdown: (markdown) => {
          timer.state.interruptions[index].note = markdown;
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
      if (result.description && editorRef.current) {
        const resolved = await resolveDriveUrls(result.description);
        editorRef.current.setValue(resolved);
      }
      if (result.category) {
        setSelectedCategory([result.category]);
      }
      if (result.taskId) {
        setSelectedTaskId(result.taskId);
        refreshTaskItems();
      }
    } catch {
      // ignore
    }
  }, [refreshTaskItems]);

  // Submit record
  const submitAndDo = useCallback(
    async (action: "break" | "nextWork" | "endSession") => {
      if (state.phase !== "work") return;
      setIsSubmitting(true);

      try {
        const endTime = new Date();
        const description = blobUrlsToDrive(editorRef.current?.getValue() || "").trim();
        const category = selectedCategory[0] || "";
        const startTime = new Date(state.startTimestamp!);
        const actualSeconds = Math.round((endTime.getTime() - startTime.getTime()) / 1000);
        const completionStatus =
          state.elapsedSeconds >= state.totalSeconds ? "completed" : "abandoned";

        const record = buildRecord(
          state,
          description,
          category,
          startTime,
          endTime,
          actualSeconds,
          completionStatus,
          selectedTaskId,
        );
        const intRecords = buildInterruptionRecords(state, record.id);

        // Ensure category exists
        if (category) {
          await ensureCategory(category, state.categories);
        }

        await serverCall("saveRecord", record);
        if (intRecords.length > 0) {
          await serverCall("saveInterruptions", intRecords);
        }

        // Clear draft before clearing form (prevents unmount flush re-saving)
        clearDraft();

        // Clear form
        editorRef.current?.clear();
        setSelectedCategory([]);
        setSelectedTaskId(null);
        setSelectedTaskLabel([]);

        // Transition timer
        if (action === "break") {
          timer.onRecordSaved();
        } else if (action === "nextWork") {
          timer.startNextWork();
        } else {
          timer.endWorkSession();
        }

        refreshAll();
      } catch (err) {
        alert("記録の保存に失敗しました: " + err);
      } finally {
        setIsSubmitting(false);
      }
    },
    [state, selectedCategory, selectedTaskId, timer, refreshAll, clearDraft],
  );

  return (
    <div className={s["record-form"]}>
      <DocumentEditor
        {...editorConfig.editorProps}
        initialValue={restoredDraft?.desc ?? ""}
        onChange={(md) => triggerSave(md)}
        placeholder="何に取り組みましたか？"
        editorRef={editorRef}
        metaTop={
          <button className={s["copy-previous-btn"]} onClick={copyFromPrevious}>
            前回をコピー
          </button>
        }
      >
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

        {taskItems.length > 0 && (
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
              const title = int.note?.split("\n")[0]?.trim() || "";
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
  description: string,
  category: string,
  startTime: Date,
  endTime: Date,
  actualSeconds: number,
  completionStatus: string,
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
    date: formatDate(endTime),
    startTime: startTime.toISOString(),
    endTime: endTime.toISOString(),
    durationSeconds: state.config.workMinutes * 60,
    actualDurationSeconds: actualSeconds,
    type: "work",
    description,
    category,
    workInterruptions: workCount,
    nonWorkInterruptions: nonWorkCount,
    workInterruptionSeconds: workIntSeconds,
    nonWorkInterruptionSeconds: nonWorkIntSeconds,
    completionStatus,
    pomodoroSetIndex: state.pomodoroSetIndex,
    taskId: taskId || "",
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
    note: i.note || "",
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
