/**
 * InterruptionForm — Shown during "interrupted" phase
 * Notion-like layout: meta → editor in single scroll, FormActions fixed at bottom
 */
import { useState, useRef, useCallback } from "react";
import { useApp } from "../../contexts/AppContext";
import { TypeToggle } from "../shared/PanelToolbar";
import { RecordField } from "../shared/RecordField";
import { FormActions } from "../shared/FormActions";
import { ItemPicker } from "../shared/ItemPicker";
import { DocumentEditor } from "../shared/DocumentEditor";
import type { MarkdownEditorRef } from "../shared/MarkdownEditorWrapper";
import { useEditorConfig } from "../../hooks/useEditorConfig";
import { blobUrlsToDrive } from "../../lib/imageCache";
import { serverCall } from "../../lib/serverCall";
import s from "./InterruptionForm.module.css";

export function InterruptionForm() {
  const { timer } = useApp();
  const editorConfig = useEditorConfig();
  const { state } = timer;

  const editorRef = useRef<MarkdownEditorRef | null>(null);
  const [isWork, setIsWork] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState<string[]>([]);

  const handleResume = useCallback(() => {
    const type = isWork ? "work" : "nonWork";
    const category = selectedCategory[0] || "";
    const note = blobUrlsToDrive(editorRef.current?.getValue() || "").trim();
    timer.endInterruption(type as "work" | "nonWork", category, note);
    // Reset form for next interruption
    setIsWork(true);
    setSelectedCategory([]);
    editorRef.current?.clear();
  }, [isWork, selectedCategory, timer]);

  const handleDiscard = useCallback(() => {
    timer.discardInterruption();
    setIsWork(true);
    setSelectedCategory([]);
    editorRef.current?.clear();
  }, [timer]);

  return (
    <div className={s["interruption-form"]}>
      <DocumentEditor
        {...editorConfig.editorProps}
        initialValue=""
        onChange={() => {}}
        placeholder="中断の内容を記録..."
        editorRef={editorRef}
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
