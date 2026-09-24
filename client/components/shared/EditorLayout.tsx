/**
 * EditorLayout — Pure presentational editor layout component
 *
 * Layout: page-root > editor-full-container > mdg-editor
 * Children are rendered as the meta section between toolbar and editor body.
 *
 * No hooks except useMemo for toolbar item resolution.
 * All editor state (editor, mode, rawMarkdown, etc.) is passed in as props.
 */
import { useRef, useMemo, useCallback, useEffect, useLayoutEffect, type ReactNode } from "react";
import { RichEditorBody, insertImageWithUpload } from "../../editor/hitomdEditor";
import type { Editor, EditorMode } from "../../editor/hitomdEditor";
import {
  captureModeScrollAnchor,
  restoreModeScrollAnchor,
  type ModeScrollAnchor,
} from "../../lib/modeScrollAnchor";
import { Toolbar, DEFAULT_TOOLBAR_ITEMS, type ToolbarItem } from "./editorToolbar";
import { RichTextIcon, MarkdownIcon } from "./Icons";
import { SaveOverlay } from "./SaveOverlay";
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
  searchNavigation?: ReactNode;
  children?: ReactNode; // meta section
  afterMeta?: ReactNode;
  scrollRef?: React.RefObject<HTMLDivElement | null>;
  saving?: boolean;
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
  searchNavigation,
  children,
  afterMeta,
  scrollRef: externalScrollRef,
  saving = false,
}: EditorLayoutProps) {
  const internalScrollRef = useRef<HTMLDivElement>(null);
  const scrollRef = externalScrollRef ?? internalScrollRef;

  // Preserve the logical document position across mode switches. Rich Text and
  // Markdown have different total heights, so a document-wide ratio alone is not enough.
  const scrollAnchorRef = useRef<ModeScrollAnchor | null>(null);
  const handleModeSwitch = useCallback(() => {
    const container = scrollRef.current;
    if (container && editor) {
      scrollAnchorRef.current = captureModeScrollAnchor({
        container,
        editor,
        mode,
        markdown: mode === "markdown" ? rawMarkdown : editor.getMarkdown(),
      });
    }
    setMode(mode === "wysiwyg" ? "markdown" : "wysiwyg");
  }, [editor, mode, rawMarkdown, setMode, scrollRef]);

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

  // Fallback auto-resize for browsers where CSS field-sizing:content doesn't work (e.g. Firefox)
  const resizeFnRef = useRef<(() => void) | null>(null);
  const fromInputRef = useRef(false);

  useLayoutEffect(() => {
    if (mode !== "markdown") {
      resizeFnRef.current = null;
      return;
    }
    const ta = scrollRef.current?.querySelector<HTMLTextAreaElement>(".mdg-raw-editor");
    if (!ta) {
      resizeFnRef.current = null;
      return;
    }
    // CSS field-sizing:content handles it natively (Chrome 123+)
    if (
      (getComputedStyle(ta) as CSSStyleDeclaration & { fieldSizing?: string }).fieldSizing ===
      "content"
    ) {
      resizeFnRef.current = null;
      return;
    }
    const root = scrollRef.current;
    const resize = () => {
      if (ta.scrollHeight > ta.clientHeight) {
        ta.style.height = `${ta.scrollHeight}px`;
      } else {
        const st = root?.scrollTop ?? 0;
        ta.style.height = "0";
        ta.style.height = `${ta.scrollHeight}px`;
        if (root) root.scrollTop = st;
      }
    };
    resizeFnRef.current = resize;
    resize();
    const onInput = () => {
      fromInputRef.current = true;
      resize();
    };
    ta.addEventListener("input", onInput);
    return () => {
      ta.removeEventListener("input", onInput);
      ta.style.height = "";
    };
  }, [mode, scrollRef]);

  // Re-measure on programmatic content changes (e.g. applyContent / onResolveLink).
  // User input already handled by the "input" event listener above, so guard with a flag.
  useLayoutEffect(() => {
    if (fromInputRef.current) {
      fromInputRef.current = false;
      return;
    }
    resizeFnRef.current?.();
  }, [rawMarkdown]);

  // Restore after textarea auto-resize. Rich content is corrected only when its layout
  // actually changes; search navigation and user-initiated scrolling take precedence.
  useEffect(() => {
    const anchor = scrollAnchorRef.current;
    if (!anchor) return;
    scrollAnchorRef.current = null;

    const container = scrollRef.current;
    if (!container || !editor) return;

    let cancelled = false;
    let frameId: number | null = null;
    let timeoutId: number | null = null;
    let expectedScrollTop: number | null = null;
    let resizeObserver: ResizeObserver | null = null;

    const removeInteractionListeners = () => {
      container.removeEventListener("scroll", handleScroll);
      container.removeEventListener("wheel", cancel);
      container.removeEventListener("touchstart", cancel);
      container.removeEventListener("pointerdown", cancel);
      window.removeEventListener("keydown", cancel, true);
    };
    const cancel = () => {
      if (cancelled) return;
      cancelled = true;
      if (frameId !== null) cancelAnimationFrame(frameId);
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      resizeObserver?.disconnect();
      removeInteractionListeners();
    };
    const handleScroll = () => {
      // Setting scrollTop in apply() also emits a scroll event. Ignore exactly that
      // position, but stop as soon as another feature or the user requests a new one.
      if (expectedScrollTop !== null && Math.abs(container.scrollTop - expectedScrollTop) <= 1) {
        expectedScrollTop = null;
        return;
      }
      cancel();
    };
    const apply = () => {
      if (cancelled) return;
      restoreModeScrollAnchor({ anchor, container, editor, mode, markdown: rawMarkdown });
      expectedScrollTop = container.scrollTop;
    };
    const scheduleApply = () => {
      if (cancelled || frameId !== null) return;
      frameId = requestAnimationFrame(() => {
        frameId = null;
        apply();
      });
    };

    container.addEventListener("scroll", handleScroll, { passive: true });
    container.addEventListener("wheel", cancel, { passive: true });
    container.addEventListener("touchstart", cancel, { passive: true });
    container.addEventListener("pointerdown", cancel, { passive: true });
    window.addEventListener("keydown", cancel, true);
    apply();

    if (mode === "wysiwyg" && typeof ResizeObserver !== "undefined") {
      let previousHeight = editor.view.dom.getBoundingClientRect().height;
      resizeObserver = new ResizeObserver(() => {
        const nextHeight = editor.view.dom.getBoundingClientRect().height;
        if (Math.abs(nextHeight - previousHeight) <= 1) return;
        previousHeight = nextHeight;
        scheduleApply();
      });
      resizeObserver.observe(editor.view.dom);
      timeoutId = window.setTimeout(cancel, 500);
    }

    return () => {
      cancel();
    };
  }, [editor, mode, rawMarkdown, scrollRef]);

  const hasToolbarSlots = toolbarLeft || toolbarRight;
  const charCountEl =
    maxCharCount && charCount != null ? (
      <span className={s["char-count"]} data-over={charCount > maxCharCount ? "" : undefined}>
        {charCount.toLocaleString()} / {maxCharCount.toLocaleString()}
      </span>
    ) : null;
  const toolbarElement = hasToolbarSlots ? (
    <div className="mdg-editor-toolbar-row">
      {toolbarLeft}
      {afterMeta ? (
        <div className={s["toolbar-spacer"]} />
      ) : (
        <div className="mdg-editor-header">
          {!readOnly && toolbarItems !== false && editor && mode === "wysiwyg" && (
            <Toolbar editor={editor} items={toolbarItems} />
          )}
          {charCountEl}
          <button
            type="button"
            className={`${s["mode-switch-btn"]} mdg-mode-btn`}
            onClick={handleModeSwitch}
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
      {!readOnly && !afterMeta && toolbarItems !== false && editor && mode === "wysiwyg" && (
        <Toolbar editor={editor} items={toolbarItems} />
      )}
      {!afterMeta && charCountEl}
      {!afterMeta && (
        <button
          type="button"
          className={`${s["mode-switch-btn"]} mdg-mode-btn`}
          onClick={handleModeSwitch}
        >
          {mode === "wysiwyg" ? <MarkdownIcon /> : <RichTextIcon />}
          {mode === "wysiwyg" ? "Markdown" : "Rich Text"}
        </button>
      )}
    </div>
  );

  return (
    <div
      ref={scrollRef}
      className={`${s["page-root"]}${afterMeta ? ` ${s["hide-editor-body"]}` : ""}`}
    >
      <SaveOverlay visible={saving} />
      <div className={`editor-full-container${className ? ` ${className}` : ""}`}>
        <div className="mdg-editor">
          {searchNavigation ? (
            <div className={s["search-toolbar-group"]}>
              {toolbarElement}
              {searchNavigation}
            </div>
          ) : (
            toolbarElement
          )}
          <div className="mdg-content-area">
            <div className={s["meta-section"]}>{children}</div>
            {afterMeta}
            {mode === "wysiwyg" ? (
              <RichEditorBody editor={editor} placeholder={placeholder} />
            ) : (
              <textarea
                className="mdg-raw-editor"
                value={rawMarkdown}
                onChange={(event) => setRawMarkdown(event.currentTarget.value)}
                placeholder={placeholder}
                readOnly={readOnly}
              />
            )}
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
