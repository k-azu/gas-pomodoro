/**
 * DocumentEditor — Unified right-panel layout component
 *
 * Wraps: page-root > editor-full-container > MarkdownEditorWrapper
 * Children are rendered as the meta section between toolbar and editor body.
 */
import { useRef, type ReactNode } from "react";
import { MarkdownEditorWrapper } from "./MarkdownEditorWrapper";
import type { MarkdownEditorRef } from "./MarkdownEditorWrapper";
import type { MentionTrigger } from "tiptap-markdown-editor";
import s from "./DocumentEditor.module.css";

interface DocumentEditorProps {
  children?: ReactNode;
  toolbarLeft?: ReactNode;
  toolbarRight?: ReactNode;
  initialValue?: string;
  documentId?: string;
  onChange?: (markdown: string) => void;
  placeholder?: string;
  onImageUpload?: (file: File) => Promise<string>;
  mentions?: MentionTrigger[];
  readOnly?: boolean;
  editorRef?: React.RefObject<MarkdownEditorRef | null>;
  className?: string;
}

export function DocumentEditor({
  children,
  toolbarLeft,
  toolbarRight,
  className,
  ...editorProps
}: DocumentEditorProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  return (
    <div ref={scrollRef} className={s["page-root"]}>
      <div className={`editor-full-container${className ? ` ${className}` : ""}`}>
        <MarkdownEditorWrapper
          {...editorProps}
          scrollContainerRef={scrollRef}
          toolbarLeft={toolbarLeft}
          toolbarRight={toolbarRight}
        >
          <div className={s["meta-section"]}>{children}</div>
        </MarkdownEditorWrapper>
      </div>
    </div>
  );
}

export function ToolbarSlot({ children }: { children: ReactNode }) {
  return <div className={s["toolbar-slot"]}>{children}</div>;
}

export function MetaTitle({ children }: { children: ReactNode }) {
  return <div className={s["meta-title-row"]}>{children}</div>;
}

/** CSS Module class for the page-root container (for use without DocumentEditor) */
export const pageRootClass = s["page-root"];
