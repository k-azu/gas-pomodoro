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
import { EditorLayout } from "../shared/EditorLayout";
import { useMarkdownEditor } from "../../hooks/useMarkdownEditor";
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

  const [charCount, setCharCount] = useState(0);

  // Draft persistence
  const { initialDraft, saveDraft, clearDraft } = useFormDraft<InterruptionDraft>(
    STORAGE_KEYS.INT_DRAFT,
  );

  const [isWork, setIsWork] = useState(initialDraft?.isWork ?? true);
  const [selectedCategory, setSelectedCategory] = useState<string[]>(initialDraft?.category ?? []);

  // Refs for latest meta values (stable onChange callback)
  const metaRef = useRef({ isWork, category: selectedCategory });
  metaRef.current = { isWork, category: selectedCategory };

  const { editor, mode, setMode, rawMarkdown, setRawMarkdown, getMarkdown, resetContent } =
    useMarkdownEditor({
      initialContent: initialDraft?.content ?? "",
      onChange: (md) => triggerSave(md),
      onCharCount: setCharCount,
      ...editorConfig.editorProps,
    });

  // Save draft helper
  const getMarkdownRef = useRef(getMarkdown);
  getMarkdownRef.current = getMarkdown;
  const triggerSave = useCallback(
    (noteOverride?: string) => {
      const content = noteOverride ?? getMarkdownRef.current();
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
    const content = blobUrlsToDrive(getMarkdown() || "").trim();
    clearDraft();
    timer.endInterruption(type as "work" | "nonWork", category, content);
    // Reset form for next interruption
    setIsWork(true);
    setSelectedCategory([]);
    resetContent("");
  }, [isWork, selectedCategory, timer, clearDraft, getMarkdown, resetContent]);

  const handleDiscard = useCallback(() => {
    clearDraft();
    timer.discardInterruption();
    setIsWork(true);
    setSelectedCategory([]);
    resetContent("");
  }, [timer, clearDraft, resetContent]);

  return (
    <div className={s["interruption-form"]}>
      <EditorLayout
        editor={editor}
        mode={mode}
        setMode={setMode}
        rawMarkdown={rawMarkdown}
        setRawMarkdown={setRawMarkdown}
        charCount={charCount}
        maxCharCount={50000}
        placeholder="中断の内容を記録..."
        onImageUpload={editorConfig.editorProps.onImageUpload}
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
      </EditorLayout>

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
