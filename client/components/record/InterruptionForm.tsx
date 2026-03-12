/**
 * InterruptionForm — Shown during "interrupted" phase
 * Notion-like layout: meta → editor in single scroll, FormActions fixed at bottom
 */
import { useState, useRef, useCallback, useEffect } from "react";
import { useApp } from "../../contexts/AppContext";
import { TypeToggle } from "../shared/PanelToolbar";
import { RecordField } from "../shared/RecordField";
import { FormActions } from "../shared/FormActions";
import { ItemPicker } from "../shared/ItemPicker";
import { DocumentEditor } from "../shared/DocumentEditor";
import type { MarkdownEditorRef } from "../shared/DocumentEditor";
import { useEditorConfig } from "../../hooks/useEditorConfig";
import { useFormDraft } from "../../hooks/useFormDraft";
import { STORAGE_KEYS } from "../../lib/localStorage";
import { blobUrlsToDrive } from "../../lib/imageCache";
import { serverCall } from "../../lib/serverCall";
import s from "./InterruptionForm.module.css";

interface InterruptionDraft {
  content: string;
  isWork: boolean;
  category: string[];
}

export function InterruptionForm() {
  const { timer } = useApp();
  const editorConfig = useEditorConfig();
  const { state } = timer;

  const editorRef = useRef<MarkdownEditorRef | null>(null);

  // Draft persistence
  const { initialDraft, saveDraft, clearDraft } = useFormDraft<InterruptionDraft>(
    STORAGE_KEYS.INT_DRAFT,
  );

  const [isWork, setIsWork] = useState(initialDraft?.isWork ?? true);
  const [selectedCategory, setSelectedCategory] = useState<string[]>(initialDraft?.category ?? []);

  // Refs for latest meta values (stable onChange callback)
  const metaRef = useRef({ isWork, category: selectedCategory });
  metaRef.current = { isWork, category: selectedCategory };

  // Save draft helper
  const triggerSave = useCallback(
    (noteOverride?: string) => {
      const content = noteOverride ?? editorRef.current?.getValue() ?? "";
      saveDraft({
        content,
        isWork: metaRef.current.isWork,
        category: metaRef.current.category,
      });
    },
    [saveDraft],
  );

  // Re-save when meta fields change
  useEffect(() => {
    triggerSave();
  }, [isWork, selectedCategory]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleResume = useCallback(() => {
    const type = isWork ? "work" : "nonWork";
    const category = selectedCategory[0] || "";
    const content = blobUrlsToDrive(editorRef.current?.getValue() || "").trim();
    clearDraft();
    timer.endInterruption(type as "work" | "nonWork", category, content);
    // Reset form for next interruption
    setIsWork(true);
    setSelectedCategory([]);
    editorRef.current?.clear();
  }, [isWork, selectedCategory, timer, clearDraft]);

  const handleDiscard = useCallback(() => {
    clearDraft();
    timer.discardInterruption();
    setIsWork(true);
    setSelectedCategory([]);
    editorRef.current?.clear();
  }, [timer, clearDraft]);

  return (
    <div className={s["interruption-form"]}>
      <DocumentEditor
        {...editorConfig.editorProps}
        initialValue={initialDraft?.content ?? ""}
        onChange={(md) => triggerSave(md)}
        placeholder="中断の内容を記録..."
        editorRef={editorRef}
        maxCharCount={50000}
      >
        <RecordField label="作業に含める">
          <TypeToggle checked={isWork} onChange={setIsWork} label="" />
        </RecordField>
        <RecordField label="カテゴリ">
          <ItemPicker
            mode="single"
            items={state.interruptionCategories}
            selected={selectedCategory}
            onSelect={setSelectedCategory}
            onColorChange={(name, color) => {
              serverCall("updateCategoryColor", name, color, "InterruptionCategories");
            }}
            placeholder="カテゴリを検索 / 作成..."
          />
        </RecordField>
      </DocumentEditor>

      {/* Action buttons — fixed at bottom */}
      <FormActions>
        <button className="btn btn-primary" onClick={handleResume}>
          再開
        </button>
        <button className="btn btn-secondary" onClick={handleDiscard}>
          キャンセル
        </button>
      </FormActions>
    </div>
  );
}
