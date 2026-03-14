/**
 * EditorLayout — Pure presentational editor layout component
 *
 * Layout: page-root > editor-full-container > mdg-editor
 * Children are rendered as the meta section between toolbar and editor body.
 *
 * No hooks except useMemo for toolbar item resolution.
 * All editor state (editor, mode, rawMarkdown, etc.) is passed in as props.
 */
import { useRef, useMemo, type ReactNode } from "react";
import {
  Toolbar,
  EditorBody,
  DEFAULT_TOOLBAR_ITEMS,
  insertImageWithUpload,
} from "tiptap-markdown-editor";
import type { Editor, EditorMode, ToolbarItem } from "tiptap-markdown-editor";
import { RichTextIcon, MarkdownIcon } from "./Icons";
import s from "./DocumentEditor.module.css";

export interface EditorLayoutProps {
  editor: Editor | null;
  mode: EditorMode;
  setMode: (mode: EditorMode) => void;
  rawMarkdown: string;
  setRawMarkdown: (md: string) => void;
  charCount?: number;
  maxCharCount?: number;
  placeholder?: string;
  readOnly?: boolean;
  className?: string;
  onImageUpload?: (file: File) => Promise<string>;
  toolbarLeft?: ReactNode;
  toolbarRight?: ReactNode;
  children?: ReactNode; // meta section
  afterMeta?: ReactNode;
  scrollRef?: React.RefObject<HTMLDivElement | null>;
}

export function EditorLayout({
  editor,
  mode,
  setMode,
  rawMarkdown,
  setRawMarkdown,
  charCount,
  maxCharCount,
  placeholder = "",
  readOnly = false,
  className,
  onImageUpload,
  toolbarLeft,
  toolbarRight,
  children,
  afterMeta,
  scrollRef: externalScrollRef,
}: EditorLayoutProps) {
  const internalScrollRef = useRef<HTMLDivElement>(null);
  const scrollRef = externalScrollRef ?? internalScrollRef;

  // Resolve toolbar items with image upload action
  const toolbarItems = useMemo((): ToolbarItem[] | false => {
    if (!onImageUpload) {
      return DEFAULT_TOOLBAR_ITEMS.filter(
        (item) => !(item.type === "button" && item.name === "image"),
      );
    }
    return DEFAULT_TOOLBAR_ITEMS.map((item) => {
      if (item.type === "button" && item.name === "image") {
        return {
          ...item,
          action: (
            ed: Parameters<NonNullable<Extract<ToolbarItem, { type: "button" }>["action"]>>[0],
          ) => {
            const input = document.createElement("input");
            input.type = "file";
            input.accept = "image/*";
            input.onchange = () => {
              const file = input.files?.[0];
              if (!file) return;
              insertImageWithUpload(ed, file, onImageUpload);
            };
            input.click();
          },
        };
      }
      return item;
    });
  }, [onImageUpload]);

  const hasToolbarSlots = toolbarLeft || toolbarRight;
  const charCountEl =
    maxCharCount && charCount != null ? (
      <span className={s["char-count"]} data-over={charCount > maxCharCount ? "" : undefined}>
        {charCount.toLocaleString()} / {maxCharCount.toLocaleString()}
      </span>
    ) : null;

  return (
    <div
      ref={scrollRef}
      className={`${s["page-root"]}${afterMeta ? ` ${s["hide-editor-body"]}` : ""}`}
    >
      <div className={`editor-full-container${className ? ` ${className}` : ""}`}>
        <div className="mdg-editor">
          {hasToolbarSlots ? (
            <div className="mdg-editor-toolbar-row">
              {toolbarLeft}
              {afterMeta ? (
                <div className={s["toolbar-spacer"]} />
              ) : (
                <div className="mdg-editor-header">
                  {toolbarItems !== false && editor && mode === "wysiwyg" && (
                    <Toolbar editor={editor} items={toolbarItems} />
                  )}
                  {charCountEl}
                  <button
                    type="button"
                    className={`${s["mode-switch-btn"]} mdg-mode-btn`}
                    onClick={() => setMode(mode === "wysiwyg" ? "markdown" : "wysiwyg")}
                  >
                    {mode === "wysiwyg" ? <MarkdownIcon /> : <RichTextIcon />}
                    {mode === "wysiwyg" ? "Markdown" : "Rich Text"}
                  </button>
                </div>
              )}
              {toolbarRight}
            </div>
          ) : (
            <div className={afterMeta ? "mdg-editor-toolbar-row" : "mdg-editor-header"}>
              {!afterMeta && toolbarItems !== false && editor && mode === "wysiwyg" && (
                <Toolbar editor={editor} items={toolbarItems} />
              )}
              {!afterMeta && charCountEl}
              {!afterMeta && (
                <button
                  type="button"
                  className={`${s["mode-switch-btn"]} mdg-mode-btn`}
                  onClick={() => setMode(mode === "wysiwyg" ? "markdown" : "wysiwyg")}
                >
                  {mode === "wysiwyg" ? <MarkdownIcon /> : <RichTextIcon />}
                  {mode === "wysiwyg" ? "Markdown" : "Rich Text"}
                </button>
              )}
            </div>
          )}
          <div className="mdg-content-area">
            <div className={s["meta-section"]}>{children}</div>
            {afterMeta}
            <EditorBody
              editor={editor}
              mode={mode}
              rawMarkdown={rawMarkdown}
              setRawMarkdown={setRawMarkdown}
              placeholder={placeholder}
              readOnly={readOnly}
            />
          </div>
        </div>
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

/** CSS Module class for the page-root container (for use without EditorLayout) */
export const pageRootClass = s["page-root"];
